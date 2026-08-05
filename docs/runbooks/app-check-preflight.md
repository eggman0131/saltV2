# Runbook — App Check serving-origin pre-flight

**Run this before flipping any App Check enforcement setting, in any project.**
It takes about a minute and it is the check that would have caught the one
origin-level misconfiguration Salt has actually hit in production.

## Why this exists

A serving origin has to appear in **two independent allowlists**, and nothing
keeps them in agreement:

1. the **browser API key**'s HTTP-referrer restrictions
   (`restrictions.browserKeyRestrictions.allowedReferrers`), and
2. the **reCAPTCHA Enterprise key**'s web settings
   (`webSettings.allowedDomains`).

On **2026-08-05** production sign-in failed from `salt.eggyman.net` — `403` on
both `firebaseappcheck …:exchangeRecaptchaEnterpriseToken` and
`identitytoolkit accounts:sendOobCode`, plus a 24-hour `appCheck/throttled`
back-off. App Check provisioning was *correct*: the prod reCAPTCHA key already
listed `salt.eggyman.net`. The custom domain had simply been omitted from the
**browser API key's** referrer list when those restrictions were tightened, so
every `?key=…` call from the real production domain was refused.

That day the blast radius was sign-in only, because Firestore data traffic does
not use the browser API key — prod App Check verifications kept flowing normally
throughout. **Under enforcement it would have been total**: an origin that cannot
mint an App Check token loses every callable, and every Firestore read too if
Firestore is enforced.

## Serving origins

| Project | Origins that must be in both lists |
| --- | --- |
| `s2-dev-eggman` | `s2-dev-eggman.web.app`, `s2-dev-eggman.firebaseapp.com` |
| `s2-stage-ccb22` | `s2-stage-ccb22.web.app`, `s2-stage-ccb22.firebaseapp.com` |
| `s2-prod-e46bd` | `s2-prod-e46bd.web.app`, `s2-prod-e46bd.firebaseapp.com`, `salt.eggyman.net` |

`localhost` is **not** a serving origin. It appears in the non-prod lists for
local development and is deliberately absent from prod's browser key.

## Step 1 — read both allowlists

`apikeys.googleapis.com` is disabled by default and is needed to read or edit the
browser key. Enable it first if the call 403s (this is a read-enablement, not an
enforcement change):

```sh
gcloud services enable apikeys.googleapis.com --project="$P"
```

Then, for each project:

```sh
TOKEN=$(gcloud auth print-access-token)
for P in s2-dev-eggman s2-stage-ccb22 s2-prod-e46bd; do
  NUM=$(gcloud projects describe "$P" --format='value(projectNumber)')
  echo "=== $P ==="
  curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" \
    "https://apikeys.googleapis.com/v2/projects/$NUM/locations/global/keys" \
    | python3 -c "
import sys,json
for k in json.load(sys.stdin).get('keys',[]):
    br=k.get('restrictions',{}).get('browserKeyRestrictions')
    if br: print(' referrers:',k.get('displayName'),'->',br.get('allowedReferrers'))
"
  curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" \
    "https://recaptchaenterprise.googleapis.com/v1/projects/$P/keys" \
    | python3 -c "
import sys,json
for k in json.load(sys.stdin).get('keys',[]):
    print(' recaptcha:',k.get('displayName'),'->',k.get('webSettings',{}).get('allowedDomains'))
"
done
```

Assert every origin from the table above appears in **both** lines for its
project. Note the two lists use different formats — the referrer list wants
`https://<origin>/*`, the reCAPTCHA list wants a bare `<origin>`.

## Step 2 — prove it end to end

Reading the lists tells you what is configured; this proves what the key actually
does. The probe has **no side effects** — an empty body is rejected on its merits
*after* the referrer check, so the response code isolates the referrer verdict:

- `400` — the key **accepted** the referrer (request then failed validation, as intended)
- `403` `API_KEY_HTTP_REFERRER_BLOCKED` — the key **refused** the referrer

```sh
probe() { # $1=origin  $2=browser API key
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' -H "Referer: https://$1/" -d '{}' \
    "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=$2")
  case $code in 400) v=ACCEPTED;; 403) v=BLOCKED;; *) v=UNEXPECTED;; esac
  printf '  %-32s %s (%s)\n' "$1" "$code" "$v"
}
```

Take each project's key from `apps/web-pwa/.env.{dev,staging,production}`
(`VITE_FIREBASE_API_KEY` — public by design, see #715), probe every origin in the
table, and **always include a negative control**:

```sh
probe salt.eggyman.net "$KEY"     # expect 400 ACCEPTED
probe evil.example.com "$KEY"     # expect 403 BLOCKED
```

A negative control that comes back `400` means the key is unrestricted — that is
a finding in its own right, and a pass on the positive probes means nothing
without it.

## Pass criteria

Every serving origin `ACCEPTED` by its own project's key, `evil.example.com`
`BLOCKED` by all three, and both allowlists containing every origin. Anything
else: **do not flip enforcement**. Fix the allowlist first, then re-run.

## Last verified

**2026-08-05** (#718 Phase 1) — all three projects pass. Both allowlists cover
every serving origin; all positive probes returned `400`, the negative control
returned `403` against all three keys.

One asymmetry, checked and benign: prod's reCAPTCHA key allows `localhost` while
prod's browser key does not. `localhost` is not a prod serving origin, and the
gap fails in the safe direction — a local client pointed at prod could mint an
App Check token but would still be refused by the API key.
