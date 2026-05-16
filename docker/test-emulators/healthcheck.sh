#!/bin/sh
# Container healthcheck for the Firebase test emulator stack (issue #84, Phase 1).
#
# Healthy ONLY when Functions triggers are registered (not merely "port open"),
# in addition to Firestore + Auth being reachable. The Functions probe mirrors
# apps/web-pwa/e2e/globalSetup.ts `waitForFunctions` exactly (OPTIONS preflight
# to matchOrCreateCanon in europe-west2, asserting the access-control-allow-origin
# response header) so Phase 2 can replace the 120s host-side poll with
# `docker compose up --wait` on identical readiness semantics.
#
# Every probe is timer-bounded (`curl --max-time`): no unbounded socket waits
# (the #79 WSL2 free-port-blackhole contract).
set -eu

FIRESTORE_URL="http://127.0.0.1:8081/"
AUTH_URL="http://127.0.0.1:9100/"
FUNCTIONS_URL="http://127.0.0.1:5002/demo-salt/europe-west2/matchOrCreateCanon"
MAX_TIME=5

# Reachable = an HTTP response with status < 500 (mirrors globalSetup
# `waitForEmulator`: res.ok || res.status < 500). curl failure -> code 000.
reachable() {
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$MAX_TIME" "$1" || echo 000)
  [ "$code" != "000" ] && [ "$code" -lt 500 ]
}

# Triggers registered = OPTIONS preflight returns a CORS allow-origin header
# (mirrors globalSetup `waitForFunctions`).
functions_triggers_registered() {
  curl -s -i -X OPTIONS \
    -H 'Origin: http://127.0.0.1:5174' \
    -H 'Access-Control-Request-Method: POST' \
    --max-time "$MAX_TIME" \
    "$FUNCTIONS_URL" 2>/dev/null \
    | grep -iq '^access-control-allow-origin:'
}

reachable "$FIRESTORE_URL" || exit 1
reachable "$AUTH_URL" || exit 1
functions_triggers_registered || exit 1
exit 0
