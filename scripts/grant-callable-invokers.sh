#!/usr/bin/env bash
#
# Grant `allUsers` the Cloud Run invoker role on every client-facing callable
# Cloud Function.
#
# WHY THIS EXISTS
# ---------------
# Salt's callables authenticate the *user* inside the function (authPolicy:
# isSignedIn() / a manual request.auth check). The underlying Cloud Run service
# must still allow `allUsers` to *invoke* it — auth then happens one layer up,
# in the function body. For 2nd-gen callables, `firebase deploy` only grants
# that public-invoker binding when it can show the interactive "allow
# unauthenticated invocations?" prompt. Our CI deploys run with
# `--non-interactive`, so that prompt is skipped and a newly created/updated
# callable comes up PRIVATE. Cloud Run then rejects browser calls at the front
# door with a 403 that carries no CORS headers, which the browser surfaces as:
#
#   "No 'Access-Control-Allow-Origin' header is present on the requested resource"
#
# i.e. a misleading CORS error that is really a missing IAM binding. See #234.
#
# This script re-applies the binding deterministically after every deploy. It is
# idempotent: granting a binding that already exists is a no-op success.
#
# USAGE
#   scripts/grant-callable-invokers.sh <gcp-project-id>
#
# Requires an authenticated gcloud (the deploy workflows authenticate via WIF
# before calling this). The active principal needs run.services.setIamPolicy
# (e.g. roles/run.admin).

set -euo pipefail

PROJECT="${1:?usage: grant-callable-invokers.sh <gcp-project-id>}"
REGION="europe-west2"

# Client-facing callables only — these are invoked over HTTPS from web-pwa.
# Firestore triggers (onCanonItemWritten, onShoppingListItemWrite) and auth
# blocking functions (beforeMemberCreated) are NOT HTTP-invoked and must stay
# private, so they are deliberately excluded. Keep this list in sync with the
# onCall/onCallGenkit exports in apps/cloud-functions/src/index.ts.
CALLABLES=(
  embedText
  arbitrateCanon
  matchOrCreateCanon
  canonicaliseRecipeIngredients
  identifyEquipment
  populateEquipmentEntry
  parseRecipeIngredients
  authorRecipe
  chefChat
  generateChatTitle
  regenerateCanonIcon
)

echo "Granting allUsers invoker on ${#CALLABLES[@]} callables in ${PROJECT} (${REGION})"

failed=()
for fn in "${CALLABLES[@]}"; do
  # The 2nd-gen Cloud Run service name is the lowercased function name.
  svc="$(echo "$fn" | tr '[:upper:]' '[:lower:]')"
  echo "== ${fn} (run service: ${svc}) =="
  if ! gcloud run services add-iam-policy-binding "$svc" \
        --region="$REGION" \
        --project="$PROJECT" \
        --member="allUsers" \
        --role="roles/run.invoker" \
        --quiet; then
    echo "::warning::failed to grant invoker on ${fn}"
    failed+=("$fn")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "::error::could not grant invoker on: ${failed[*]}"
  exit 1
fi

echo "All callable invoker bindings applied."
