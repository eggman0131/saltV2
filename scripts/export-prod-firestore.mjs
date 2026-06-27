#!/usr/bin/env node
// Task Pilot one-shot: export the PRODUCTION Firestore database to a GCS bucket.
//
// This is the SAFE half of the prod→staging refresh — it is read-only against
// prod. Pair it with scripts/restore-staging-from-prod.mjs, which wipes staging
// and imports the newest export this produces.
//
// Why managed export: it does NOT bill document reads and does NOT fire Cloud
// Functions triggers, so it is cheap and side-effect-free on prod. `gcloud
// firestore export` blocks until the operation completes, so a Task Pilot click
// that returns success means the export is on GCS and ready to restore.
//
// Auth: your local `gcloud` active account (`gcloud auth login`). Needs the
// Firestore "Import Export Admin" role on prod and write access to the bucket.
//
// One-time setup (this script prints it if the bucket is missing):
//   LOC=$(gcloud firestore databases describe --project=<PROD> --format='value(locationId)')
//   gcloud storage buckets create gs://<PROD>-firestore-exports --project=<PROD> --location=$LOC

import { execFileSync } from 'node:child_process';

const PROD_PROJECT = process.env.SALT_PROD_PROJECT ?? 's2-prod-e46bd';
const BUCKET = process.env.SALT_FS_EXPORT_BUCKET ?? `gs://${PROD_PROJECT}-firestore-exports`;

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function commandExists(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!commandExists('gcloud')) {
  console.error('✖ gcloud CLI not found. Install the Google Cloud SDK, then `gcloud auth login`.');
  process.exit(1);
}

// Preflight: the export bucket must already exist (one-time setup).
let bucketOk = true;
try {
  execFileSync('gcloud', ['storage', 'buckets', 'describe', BUCKET, '--format=value(name)'], {
    stdio: 'ignore',
  });
} catch {
  bucketOk = false;
}
if (!bucketOk) {
  console.error(`✖ Export bucket ${BUCKET} not found (or no access). One-time setup:`);
  console.error(`    gcloud storage buckets create ${BUCKET} --project=${PROD_PROJECT} --location=US`);
  console.error(
    '    # --location must match the DB location: multi-region nam5 -> US, eur3 -> EU;',
  );
  console.error('    # a regional DB (e.g. europe-west2) uses that region. See docs/data-refresh.md.');
  console.error('  (The restore step also needs staging granted read on this bucket — see docs/data-refresh.md.)');
  process.exit(1);
}

// Timestamped, lexically-sortable, GCS-safe prefix (no ':' or '.'). The restore
// script picks the newest such prefix, so naming order == recency order.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = `${BUCKET}/${stamp}`;

console.log(`Exporting Firestore: project=${PROD_PROJECT} → ${dest}`);
console.log('(read-only on prod; no Cloud Functions triggers fire; blocks until complete)\n');

try {
  run('gcloud', ['firestore', 'export', dest, `--project=${PROD_PROJECT}`]);
} catch {
  console.error('\n✖ Export failed. Check `gcloud auth login` and your Firestore export IAM role on prod.');
  process.exit(1);
}

console.log(`\n✔ Export complete: ${dest}`);
console.log('  Next: run the "Restore Staging from Prod" task to load it into staging.');
