# Releases & Environments

How Salt ships. The release model is **trunk-based**: `main` is always releasable,
merges to `main` auto-deploy to **staging**, and a published **GitHub Release**
promotes that *same commit* to **production** behind a manual approval gate.
Full plan and phases: GitHub issue #118.

> Environment is a deploy **target**, not a branch. We deliberately do **not**
> keep long-lived `dev`/`staging` branches — see #118 for the rationale and the
> conditions under which we'd revisit.

## Firebase projects (`.firebaserc` aliases)

| Alias        | Project ID       | Plan  | Used for                                  |
| ------------ | ---------------- | ----- | ----------------------------------------- |
| `default`    | `demo-salt`      | —     | Local emulators only (no real network)    |
| `staging`    | `s2-stage-ccb22` | Blaze | Auto-deployed on merge to `main`          |
| `production` | `s2-prod-e46bd`  | Blaze | Promoted from a GitHub Release (gated)     |

Deploys always target an alias explicitly: `firebase deploy -P staging` /
`-P production`. Bare `firebase` commands hit `default` (emulators), which is
the safe local default.

## Config & secrets — what lives where

There are two distinct classes. Getting the split right is the whole game:
**client config is public and committed; runtime secrets never touch the repo.**

### 1. Client config — build-time, committed, **not secret**

Lives in `apps/web-pwa/.env.<mode>` (Vite picks the file by `--mode`). These are
**public identifiers** that ship in the browser bundle — committing them is
correct and expected. They are guarded by Firestore/Storage security rules and
API-key restrictions, not by secrecy.

| Variable                            | Notes                                              |
| ----------------------------------- | -------------------------------------------------- |
| `VITE_FIREBASE_API_KEY`             | Public web API key (per project)                   |
| `VITE_FIREBASE_AUTH_DOMAIN`         | `<project>.firebaseapp.com`                        |
| `VITE_FIREBASE_PROJECT_ID`          | Firebase project ID                                |
| `VITE_FIREBASE_STORAGE_BUCKET`      | `<project>.firebasestorage.app`                    |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Sender ID                                          |
| `VITE_FIREBASE_APP_ID`              | Web app ID                                         |
| `VITE_LD_CLIENT_SIDE_ID`            | LaunchDarkly **client-side** ID — public, per **LD environment** (staging ≠ prod) |
| `VITE_USE_EMULATORS`                | `false` for staging/production                     |

Each environment must use its **own** values; in particular the LD client-side ID
must point at the matching LaunchDarkly environment.

Each deploy target maps to its own LaunchDarkly environment (dev / staging /
production) — the client-side ID and SDK key are a matched pair per LD env.

- `.env.development` — emulators; LD env `dev`.
- `.env.staging` — fully populated for `s2-stage-ccb22`; LD env `staging`.
- `.env.production` — fully populated for `s2-prod-e46bd`; LD env `production`.

### 2. Cloud Functions runtime secrets — Secret Manager, per project, **never committed**

These are real secrets. They live in Google Secret Manager, set **per Firebase
project**, and are bound to the functions via `defineSecret()` in
`apps/cloud-functions/src`. They must differ between staging and production
(sharing one would let staging traffic bill/pollute prod).

| Secret          | What it is                                              | Set with                                          |
| --------------- | ------------------------------------------------------- | ------------------------------------------------- |
| `GEMINI_API_KEY` | Gemini/Genkit API key for the AI flows                 | `firebase functions:secrets:set GEMINI_API_KEY -P <alias>` |
| `LD_SDK_KEY`     | LaunchDarkly **server** SDK key; also used as the LD observability project id for CF span export | `firebase functions:secrets:set LD_SDK_KEY -P <alias>` |

The LD OTLP trace endpoint is a hardcoded constant in
`ld-observability/server` — there is **no** separate OTLP secret or endpoint var.

### 3. CI / GitHub Environments

CI authenticates to Firebase via **Workload Identity Federation** (no long-lived
key in the repo — see #118 Phase 2). Two GitHub Environments scope what each
deploy job can see:

| Environment  | Protection           | Holds                                                        |
| ------------ | -------------------- | ----------------------------------------------------------- |
| `staging`    | none (auto-deploy)   | staging WIF provider + service-account refs                 |
| `production` | required reviewer (maintainer) = the approval gate | production WIF provider + service-account refs |

PR preview deploys use **staging-scoped** config only; production secrets are
never exposed to PR-triggered jobs.

#### WIF identifiers (provisioned — Phase 2)

These are **not secret** (resource paths + SA emails). The deploy workflows pass
them to `google-github-actions/auth` as `workload_identity_provider` +
`service_account`, sourced per GitHub Environment.

| Env          | `workload_identity_provider`                                                                  | `service_account`                            | Impersonation scope |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------- |
| `staging`    | `projects/946977631175/locations/global/workloadIdentityPools/github-actions/providers/github` | `gha-deployer@s2-stage-ccb22.iam.gserviceaccount.com` | repo `eggman0131/saltV2` (covers PR previews) |
| `production` | `projects/140613398002/locations/global/workloadIdentityPools/github-actions/providers/github` | `gha-deployer@s2-prod-e46bd.iam.gserviceaccount.com`  | **only** the `production` GitHub Environment |

The OIDC provider on both projects is restricted to
`assertion.repository == 'eggman0131/saltV2'`; no long-lived key exists anywhere.

## First deploy to a fresh project (one-time bootstrap)

A brand-new Firebase project needs one-time setup that the CI deployer SA
**cannot** do itself (it deliberately lacks project-IAM-admin). Done for staging;
**still required for production before its first deploy.**

1. **Enable the required APIs** (the SA can *use* APIs but not enable them):
   `firebasestorage`, `cloudfunctions`, `cloudbuild`, `artifactregistry`, `run`,
   `eventarc`, `pubsub`, `firestore`, `firebasehosting`, `storage`,
   `secretmanager`, `cloudbilling`, plus `iamcredentials` + `sts` (WIF).
   `gcloud services enable <api>… --project=<id>`.
2. **Run the first deploy as an owner** (local `firebase deploy -P <alias>`).
   This performs the one-time service-agent IAM setup that gen2 functions need
   (Pub/Sub, Eventarc service agents) — which the SA can't do. Expect to retry:
   the `gcf-admin-robot` and Eventarc service agents provision asynchronously on
   first use, so the first one or two attempts can fail with `404 … Not found`
   or "Eventarc permissions still propagating" — wait a few minutes and retry.
3. After that, **CI/SA deploys work** without any standing IAM-admin grant.

> Note: `firebase deploy` will not change a function's trigger type in place. If
> an interrupted first deploy leaves a Firestore-trigger function as an `https`
> stub, `firebase functions:delete <name> --region <region>` and redeploy.

## Setup status

- [x] Staging Firebase project (`s2-stage-ccb22`, Blaze) + alias + `.env.staging` config
- [x] Production Firebase project (`s2-prod-e46bd`, Blaze) + alias + `.env.production` config
- [x] `VITE_LD_CLIENT_SIDE_ID` for dev / staging / production (matched LD envs)
- [x] WIF setup — staging (repo-scoped) and production (environment-scoped)
- [x] `LD_SDK_KEY` secret set in staging + production Secret Manager
- [x] `GEMINI_API_KEY` secret set in staging + production Secret Manager
- [x] GitHub Environments (`staging`, `production`) + production required-reviewer gate
- [x] Staging deploy workflow (`deploy-staging.yml` — on CI success on `main`)
- [x] Staging first-deploy bootstrap (APIs + service agents) done
- [x] **First end-to-end staging deploy verified** (CI/SA → https://s2-stage-ccb22.web.app)
- [ ] Production first-deploy bootstrap (APIs done; owner bootstrap deploy still needed)
- [ ] Production deploy workflow (on GitHub Release) — Phase 4
- [x] ~~PR preview channels~~ — **dropped** (#126 reverted). The whole app sits behind an auth gate and magic-link sign-in can't run on a preview's unauthorized, per-PR origin, so a preview only ever shows the login page. Verify on the staging domain after merge instead.
- [ ] End-of-greenfield doc note — Phase 6
