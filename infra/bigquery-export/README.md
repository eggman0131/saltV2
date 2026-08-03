# Firestore → BigQuery export (issue #684)

Streams every document write in `recipes`, `canonItems`, `productForms` and
`cookSessions` to an append-only BigQuery changelog, via four instances of the
[`firebase/firestore-bigquery-export`](https://extensions.dev/extensions/firebase/firestore-bigquery-export)
extension. This is the app's only history: Firestore is delete-means-delete with
full-document LWW, so past states exist nowhere else. `chatSessions` is
deliberately **excluded** — chat volume is measured by content-free PostHog
events, and streaming those docs would persist message content past the
collection's TTL.

## Why this directory is not in the root `firebase.json`

Both deploy workflows run a bare `firebase deploy` (no `--only`), so an
`extensions` block in the root config would make CI install these on **staging**
at the next merge to `main` — and fail there anyway, because the deployer SA
holds no BigQuery/extensions grants (the same silent-failure shape as the Cloud
Tasks / Cloud Scheduler traps in [docs/releases.md](../../docs/releases.md)).
This is a **production-only, one-off owner install**, so its manifest lives here
where no workflow can see it.

## Install (one-off, as an owner)

```bash
cd infra/bigquery-export
npx firebase deploy --only extensions --project s2-prod-e46bd --non-interactive --force
```

The project id is spelled out rather than aliased — deliberate friction for a
prod-only operation. Installing on another environment is possible but pointless
noise; the BigQuery dataset would just mirror that environment's own project.

## Backfill (immediately after install)

The changelog only accrues from install; the import script backfills the
current state of pre-existing docs as `IMPORT` rows. Run it per collection,
**after** the extension has created the tables.

> **Done on prod 2026-08-03** — recipes 46, canonItems 219, productForms 6,
> cookSessions 4. This is a **one-shot**: the script has no idempotency, so a
> second run appends a duplicate set of `IMPORT` rows. Re-run only after a table
> rebuild.

`npx` cannot run the tool directly: a fresh install resolves
`@firebase/database-compat` 2.1.5, whose standalone bundle requires an
`@firebase/app` peer that does not get installed, so the CLI dies on
`MODULE_NOT_FOUND` before it does anything. Same breakage that hit Cloud
Functions installs on 2026-07-30. Pin it in a throwaway directory:

```bash
mkdir -p /tmp/bq-import && cd /tmp/bq-import
cat > package.json <<'EOF'
{
  "name": "bq-import-runner",
  "private": true,
  "version": "1.0.0",
  "overrides": { "@firebase/database-compat": "2.1.4" },
  "dependencies": { "@firebaseextensions/fs-bq-import-collection": "latest" }
}
EOF
npm install
```

Then, per collection:

```bash
./node_modules/.bin/fs-bq-import-collection \
  --non-interactive \
  --project s2-prod-e46bd \
  --big-query-project s2-prod-e46bd \
  --source-collection-path recipes \
  --dataset firestore_export \
  --table-name-prefix recipes \
  --dataset-location us \
  --query-collection-group false \
  --multi-threaded false \
  --use-new-snapshot-query-syntax true \
  --firestore-instance-id '(default)'
# repeat for: canonItems, productForms, cookSessions (matching --table-name-prefix)
```

The last four flags are not optional padding. `--non-interactive` suppresses the
prompts but supplies no defaults, so omitting `--query-collection-group` is a
hard `[ERROR] QueryCollectionGroup is not specified.` And
`--use-new-snapshot-query-syntax true` must mirror the extension's
`USE_NEW_SNAPSHOT_QUERY_SYNTAX=yes` — the flag decides how the import rewrites
the `_raw_latest` view, so a mismatch leaves the view disagreeing with the
changelog the live extension is writing.

Verify the backfill by checking the views against the source of truth — they
should equal the counts in the daily `volumetrics.snapshot` PostHog event:

```sql
SELECT COUNT(*) FROM `s2-prod-e46bd.firestore_export.recipes_raw_latest`
```

## What you get

Dataset `firestore_export` in the prod project, per collection:

- `<collection>_raw_changelog` — one row per write: `timestamp`, `document_id`,
  `operation` (`CREATE`/`UPDATE`/`DELETE`/`IMPORT`), full doc as JSON in `data`.
- `<collection>_raw_latest` — view of the current collection state.

Query in the BigQuery console (`JSON_VALUE(data, '$.kind')` etc.). No standing
dashboards on this — the consolidated PostHog dashboard is the viewing surface;
this is the vault for history and ad-hoc SQL.

## Parameter notes

- `DATABASE_REGION=nam5` / `DATASET_LOCATION=us`: the Firestore database is
  **nam5 (US multi-region)** — verified with
  `gcloud firestore databases describe --project s2-prod-e46bd`, not assumed
  from the europe-west2 functions region. The dataset colocates with the source.
- No partitioning/clustering/materialized views: the data is megabytes; the
  free-tier defaults are the right size. Partitioning cannot be changed on an
  existing table, so revisit only alongside a table rebuild.
