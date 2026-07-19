#!/usr/bin/env bash
# Deploy ONLY the dev-cloud (s2-dev-eggman) targets your working tree touches.
#
# Deploys the files on disk right now — uncommitted + this branch's changes vs
# main — no commit/push needed. It maps changed paths to Firebase targets, builds
# the PWA only when hosting is in play (hosting has no predeploy hook in
# firebase.json, unlike functions), and deploys just those targets.
#
#   pnpm deploy:dev              # auto-detect from working-tree changes
#   BASE=HEAD pnpm deploy:dev    # only uncommitted/untracked changes
#   BASE=<ref> pnpm deploy:dev   # diff against an arbitrary ref
#   ONLY=functions pnpm deploy:dev   # force an explicit target list, skip detection
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${ONLY:-}" ]]; then
  only="$ONLY"
  case ",$only," in *,hosting,*) need_hosting=true ;; *) need_hosting=false ;; esac
  case ",$only," in *,functions,*) need_functions=true ;; *) need_functions=false ;; esac
else
  base="${BASE:-$(git merge-base HEAD main 2>/dev/null \
    || git merge-base HEAD origin/main 2>/dev/null || echo HEAD)}"
  changed="$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u )"

  if [[ -z "$changed" ]]; then
    echo "No changes vs ${base} — nothing to deploy."
    exit 0
  fi

  need_functions=false; need_hosting=false; need_firestore=false; need_storage=false
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
  echo "Changed vs ${base} → deploying: ${only}"
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
