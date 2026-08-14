#!/usr/bin/env bash
# Deploy ONLY the dev-cloud (s2-dev-eggman) targets your working tree touches.
#
# Deploys the files on disk right now — uncommitted + this branch's changes vs
# main — no commit/push needed. It maps changed paths to Firebase targets, builds
# the PWA only when hosting is in play (hosting has no predeploy hook in
# firebase.json, unlike functions), and deploys just those targets.
#
#   pnpm deploy:dev              # auto-detect: what changed since dev last got deployed
#   BASE=HEAD pnpm deploy:dev    # only uncommitted/untracked changes
#   BASE=<ref> pnpm deploy:dev   # diff against an arbitrary ref
#   ONLY=functions pnpm deploy:dev   # force an explicit target list, skip detection
set -euo pipefail
cd "$(dirname "$0")/.."

# The commit this machine last deployed to dev from. Detection used to diff
# against main, which answers the wrong question: on main — or on any branch
# after your PR merged — merge-base is HEAD itself, so everything already
# committed looked like "nothing to deploy" while the dev cloud sat several
# commits behind. Nothing server-side records what is live on dev (it is
# deployed from any branch, ungated), so we keep the record here. .firebase/ is
# already the CLI's own gitignored bookkeeping directory.
state_file=".firebase/dev-deploy-base"

if [[ -n "${ONLY:-}" ]]; then
  only="$ONLY"
  case ",$only," in *,hosting,*) need_hosting=true ;; *) need_hosting=false ;; esac
  case ",$only," in *,functions,*) need_functions=true ;; *) need_functions=false ;; esac
else
  base="${BASE:-}"
  if [[ -z "$base" && -f "$state_file" ]]; then
    # Resolve it: a recorded commit can vanish under a rebase or a branch delete.
    base="$(git rev-parse --verify --quiet "$(cat "$state_file")^{commit}" || true)"
  fi

  need_functions=false; need_hosting=false; need_firestore=false; need_storage=false
  if [[ -z "$base" ]]; then
    echo "No usable record of a previous dev deploy — deploying every target."
    need_functions=true; need_hosting=true; need_firestore=true; need_storage=true
  else
    changed="$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u )"

    if [[ -z "$changed" ]]; then
      echo "Nothing has changed since dev was last deployed ($(git rev-parse --short "$base")) — nothing to deploy."
      echo "Force it with e.g. ONLY=functions,hosting pnpm deploy:dev"
      exit 0
    fi

    while IFS= read -r f; do
      case "$f" in
        apps/cloud-functions/*)                            need_functions=true ;;
        apps/web-pwa/* | packages/ui-components/* | packages/adapters/firebase-sync/*)
                                                           need_hosting=true ;;
        # Shared layers feed both the PWA and the functions bundle → deploy both.
        packages/domain/* | packages/shared-types/* | packages/adapters/observability/*)
                                                           need_functions=true; need_hosting=true ;;
        firestore.rules | firestore.indexes.json)          need_firestore=true ;;
        storage.rules)                                     need_storage=true ;;
        # Config change can touch any target — redeploy everything to be safe.
        firebase.json)
          need_functions=true; need_hosting=true; need_firestore=true; need_storage=true ;;
      esac
    done <<< "$changed"
  fi

  targets=()
  if $need_functions; then targets+=("functions"); fi
  if $need_hosting;   then targets+=("hosting"); fi
  if $need_firestore; then targets+=("firestore"); fi
  if $need_storage;   then targets+=("storage"); fi

  if [[ ${#targets[@]} -eq 0 ]]; then
    echo "Changes detected but none map to a deploy target (tests/docs only) — skipping."
    exit 0
  fi
  only="$(IFS=,; echo "${targets[*]}")"
  if [[ -n "$base" ]]; then
    echo "Changed since $(git rev-parse --short "$base") → deploying: ${only}"
  else
    echo "Deploying: ${only}"
  fi
fi

# hosting has NO predeploy hook in firebase.json, so build the PWA ourselves
# (functions builds via its own predeploy hook). --mode dev loads apps/web-pwa/.env.dev.
if [[ "$need_hosting" == true ]]; then
  pnpm --filter @salt/web-pwa build:dev
fi

pnpm exec firebase deploy --only "$only" -P dev

# New 2nd-gen callables come up PRIVATE on create (#234); re-assert the public
# invoker binding so the browser isn't rejected with 403/no-CORS. Idempotent.
if [[ "$need_functions" == true ]]; then
  ./scripts/grant-callable-invokers.sh s2-dev-eggman
fi

# Everything above ran under `set -e`, so reaching here means the deploy stuck.
# Only stamp on an auto-detected run: an ONLY= run deploys a subset you chose, so
# stamping would silently swallow whatever else was still pending. Uncommitted
# work stays in the next diff (it differs from HEAD until committed) and simply
# redeploys — redundant, never missed.
if [[ -z "${ONLY:-}" ]]; then
  mkdir -p "$(dirname "$state_file")"
  git rev-parse HEAD > "$state_file"
fi
