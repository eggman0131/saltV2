# Refreshing staging with prod data

To test a migration or bug fix against real data, you can replace **staging's**
Firestore with a faithful copy of **prod**. This is a two-step, two-click flow in
the **Task Pilot** sidebar:

1. **Export Prod Firestore** — read-only managed export of prod to a GCS bucket.
2. **Restore Staging from Prod** — wipes staging, then imports the newest export.

Both are one-shot tasks ([.vscode/tasks.json](../.vscode/tasks.json)); the
scripts live in [scripts/](../scripts/).

## Why managed export/import (and not a copy script)

Managed import **does not fire Cloud Functions triggers**. A hand-rolled
Admin-SDK copy would re-fire `onShoppingListItemWrite` (Gemini) and
`onCanonItemWritten` (icon generation) in the target project — burning cost and
mutating the very data you just copied. Managed export/import also doesn't bill
document reads, handles subcollections, and runs on your local CLI credentials.
It's also why this is **developer tooling, not an in-app admin button**: Cloud
Functions deploy from one codebase to both envs, so a wipe-and-restore callable
would also exist in prod.

## One-time setup

The export bucket must exist, and staging's Firestore service agent must be able
to read it. The scripts print these commands if something's missing.

```bash
# Create the export bucket in the same location as prod's database.
LOC=$(gcloud firestore databases describe --project=s2-prod-e46bd --format='value(locationId)')
gcloud storage buckets create gs://s2-prod-e46bd-firestore-exports \
  --project=s2-prod-e46bd --location="$LOC"

# Let staging read the bucket (needed by the import step).
NUM=$(gcloud projects describe s2-stage-ccb22 --format='value(projectNumber)')
gcloud storage buckets add-iam-policy-binding gs://s2-prod-e46bd-firestore-exports \
  --member="serviceAccount:service-$NUM@gcp-sa-firestore.iam.gserviceaccount.com" \
  --role=roles/storage.objectViewer

# (optional) auto-delete old exports after 7 days
gcloud storage buckets update gs://s2-prod-e46bd-firestore-exports \
  --lifecycle-file=/dev/stdin <<'JSON'
{ "rule": [ { "action": {"type": "Delete"}, "condition": {"age": 7} } ] }
JSON
```

You authenticate with your own `gcloud auth login` and `firebase login`; both
already grant you access to prod and staging via the deploy roles.

## Usage

1. Click **Export Prod Firestore**. It blocks until the export completes and
   prints the GCS path on success.
2. Click **Restore Staging from Prod**. It selects the newest export, prints the
   plan, and asks you to type `STAGING` before it wipes and restores.

## Safety

- The restore **hard-refuses** any target that isn't staging (it bails if the
  project equals prod or matches `/prod/i`).
- It requires typing `STAGING` to confirm before the destructive wipe.
- The export is read-only on prod.

## After a restore — re-apply staging-only config

A restore is a **full mirror**, so these come across from prod and may need
attention:

- **`appSettings` / `devSettings`** — env-specific config (Gemini model per role,
  kill-switches like canon-icon generation). Staging now holds prod's values;
  re-apply any staging overrides.
- **`chatSessions`** — real users' chat history (per-user, TTL'd) is now in
  staging. Fine for most testing, but be aware of it.
- **`members`** — staging's login allowlist is now prod's, so your real account
  can sign in. Note the export carries the `members` allowlist docs only —
  Firebase **Auth** accounts are separate, so you just re-authenticate and the
  `beforeMemberCreated` blocking function admits you.

## Scope

This refreshes **prod → staging** only. Local **dev** uses the Firestore
emulator with its own export-on-exit data ([pnpm dev:emulators](../package.json));
it is intentionally not a target of this flow.
