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

## Setup status

- [x] Staging Firebase project (`s2-stage-ccb22`, Blaze) + alias + `.env.staging` config
- [x] Production Firebase project (`s2-prod-e46bd`, Blaze) + alias + `.env.production` config
- [x] `VITE_LD_CLIENT_SIDE_ID` for dev / staging / production (matched LD envs)
- [x] WIF setup — staging (repo-scoped) and production (environment-scoped)
- [x] `LD_SDK_KEY` secret set in staging + production Secret Manager
- [x] `GEMINI_API_KEY` secret set in staging + production Secret Manager
- [ ] GitHub Environments (`staging`, `production`) + production approval rule
- [ ] Deploy workflows (staging on merge, production on Release)
- [ ] PR preview channels
