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
**after** the extension has created the tables:

```bash
npx @firebaseextensions/fs-bq-import-collection \
  --non-interactive \
  --project s2-prod-e46bd \
  --big-query-project s2-prod-e46bd \
  --source-collection-path recipes \
  --dataset firestore_export \
  --table-name-prefix recipes \
  --dataset-location us
# repeat for: canonItems, productForms, cookSessions (matching --table-name-prefix)
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
