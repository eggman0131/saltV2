#!/usr/bin/env node
// Task Pilot one-shot: WIPE staging Firestore and restore it from the newest
// prod export (produced by scripts/export-prod-firestore.mjs).
//
// DESTRUCTIVE — deletes ALL staging collections, then imports a full copy of
// prod. The point is a faithful mirror for testing a migration or bug fix
// against real data. It refuses to target anything but staging and makes you
// type STAGING to confirm before the wipe.
//
// Why managed import: it does NOT fire Cloud Functions triggers, so the
// canon-match / icon-gen pipelines do not storm staging on the way in — they
// only run when you later exercise the migration/fix.
//
// After the restore, staging's `appSettings` / `devSettings` singletons hold
// PROD's values (model selection, kill-switches) and `chatSessions` holds real
// users' history. Re-apply any staging-specific config you need.
//
// Auth: local `gcloud` (firestore import) + `firebase` (firestore:delete), both
// already used for deploys. Staging's Firestore service agent must have read on
// the export bucket — the script prints the grant command if the import is denied.

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const PROD_PROJECT = process.env.SALT_PROD_PROJECT ?? 's2-prod-e46bd';
const STAGING_PROJECT = process.env.SALT_STAGING_PROJECT ?? 's2-stage-ccb22';
const BUCKET = process.env.SALT_FS_EXPORT_BUCKET ?? `gs://${PROD_PROJECT}-firestore-exports`;

// ── Hard safety guard: this task wipes its target, so it must NEVER hit prod ──
if (STAGING_PROJECT === PROD_PROJECT || /prod/i.test(STAGING_PROJECT)) {
  console.error(`✖ Refusing to run: target "${STAGING_PROJECT}" looks like production.`);
  console.error('  This task wipes its target; it is only ever allowed to hit staging.');
  process.exit(1);
}

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

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => (rl.close(), resolve(answer))));
}

for (const cmd of ['gcloud', 'firebase']) {
  if (!commandExists(cmd)) {
    console.error(`✖ ${cmd} CLI not found. Install it and authenticate (gcloud auth login / firebase login).`);
    process.exit(1);
  }
}

// Find the newest export prefix in the bucket. Export prefixes are timestamped
// subdirectories, so the lexically-greatest one is the most recent.
let listing;
try {
  listing = execFileSync('gcloud', ['storage', 'ls', `${BUCKET}/`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
} catch {
  console.error(`✖ Could not list ${BUCKET}. Run "Export Prod Firestore" first.`);
  process.exit(1);
}
const exportPath = listing
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith(`${BUCKET}/`) && line.endsWith('/'))
  .sort()
  .at(-1)
  ?.replace(/\/$/, '');
if (!exportPath) {
  console.error(`✖ No exports found in ${BUCKET}. Run "Export Prod Firestore" first.`);
  process.exit(1);
}

console.log('────────────────────────────────────────────────────────────');
console.log(' Restore staging Firestore from a prod export');
console.log('────────────────────────────────────────────────────────────');
console.log(`  Target (WIPED, then restored): ${STAGING_PROJECT}`);
console.log(`  Source export:                 ${exportPath}`);
console.log('');
console.log('  This DELETES every collection in staging, then imports the export.');
console.log('  Managed import does not fire Cloud Functions triggers.');
console.log('');

const answer = await ask('  Type STAGING to proceed (anything else aborts): ');
if (answer.trim() !== 'STAGING') {
  console.log('Aborted. Nothing was changed.');
  process.exit(0);
}

console.log(`\n› Wiping all collections in ${STAGING_PROJECT} …`);
try {
  run('firebase', ['firestore:delete', '--all-collections', '--project', STAGING_PROJECT, '--force']);
} catch {
  console.error('✖ Wipe failed. Check `firebase login` and your access to staging.');
  process.exit(1);
}

console.log(`\n› Importing ${exportPath} into ${STAGING_PROJECT} … (blocks until complete)`);
try {
  run('gcloud', ['firestore', 'import', exportPath, `--project=${STAGING_PROJECT}`]);
} catch {
  console.error('\n✖ Import failed. If this is a permission error, grant staging read on the bucket.');
  console.error('  Cross-project import needs BOTH storage.buckets.get and storage.objects.get,');
  console.error('  so grant objectViewer AND legacyBucketReader (objectViewer alone is NOT enough —');
  console.error('  it lacks storage.buckets.get, which the import checks against the bucket root):');
  console.error(`    NUM=$(gcloud projects describe ${STAGING_PROJECT} --format='value(projectNumber)')`);
  console.error('    for ROLE in roles/storage.objectViewer roles/storage.legacyBucketReader; do');
  console.error(`      gcloud storage buckets add-iam-policy-binding ${BUCKET} \\`);
  console.error('        --member="serviceAccount:service-$NUM@gcp-sa-firestore.iam.gserviceaccount.com" \\');
  console.error('        --role="$ROLE"');
  console.error('    done');
  process.exit(1);
}

console.log(`\n✔ Staging restored from ${exportPath}.`);
console.log('  Reminder: appSettings/devSettings now hold PROD values, and chatSessions holds');
console.log('  real user history — re-apply staging-specific config if needed.');
