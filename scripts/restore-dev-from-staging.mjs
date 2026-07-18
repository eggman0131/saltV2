#!/usr/bin/env node
// Task Pilot one-shot: WIPE dev-cloud Firestore and restore it from the newest
// staging export (produced by scripts/export-staging-firestore.mjs).
//
// DESTRUCTIVE — deletes ALL dev collections, then imports a full copy of
// staging. The point is a faithful, agent-reachable mirror on the ungated
// dev-cloud project (s2-dev-eggman) for exercising a change against real-shaped
// data without the CI gate. It refuses to target anything but dev and makes you
// type DEV to confirm before the wipe.
//
// Sibling of scripts/restore-staging-from-prod.mjs (prod→staging). dev-cloud is
// disposable scratch by design (see the firebase-dev env notes), so wiping it is
// expected and cheap.
//
// Why managed import: it does NOT fire Cloud Functions triggers, so the
// canon-match / icon-gen pipelines do not storm dev on the way in — they only
// run when you later exercise the change.
//
// After the restore, dev's `appSettings` / `devSettings` singletons hold
// STAGING's values (model selection, kill-switches) and `chatSessions` holds
// staging users' history. Re-apply any dev-specific config you need.
//
// Auth: local `gcloud` (firestore import) + `firebase` (firestore:delete), both
// already used for deploys. Dev's Firestore service agent must have read on the
// export bucket — the script prints the grant command if the import is denied.

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const STAGING_PROJECT = process.env.SALT_STAGING_PROJECT ?? 's2-stage-ccb22';
const DEV_PROJECT = process.env.SALT_DEV_PROJECT ?? 's2-dev-eggman';
const BUCKET = process.env.SALT_FS_STAGING_EXPORT_BUCKET ?? `gs://${STAGING_PROJECT}-firestore-exports`;

// ── Hard safety guard: this task wipes its target, so it must ONLY ever hit dev.
// Refuse anything that looks like prod or staging. ──
if (
  DEV_PROJECT === STAGING_PROJECT ||
  /prod/i.test(DEV_PROJECT) ||
  /stag/i.test(DEV_PROJECT) ||
  !/dev/i.test(DEV_PROJECT)
) {
  console.error(`✖ Refusing to run: target "${DEV_PROJECT}" is not an obvious dev project.`);
  console.error('  This task wipes its target; it is only ever allowed to hit dev-cloud.');
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
  console.error(`✖ Could not list ${BUCKET}. Run "Export Staging Firestore" first.`);
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
  console.error(`✖ No exports found in ${BUCKET}. Run "Export Staging Firestore" first.`);
  process.exit(1);
}

console.log('────────────────────────────────────────────────────────────');
console.log(' Restore dev-cloud Firestore from a staging export');
console.log('────────────────────────────────────────────────────────────');
console.log(`  Target (WIPED, then restored): ${DEV_PROJECT}`);
console.log(`  Source export:                 ${exportPath}`);
console.log('');
console.log('  This DELETES every collection in dev, then imports the export.');
console.log('  Managed import does not fire Cloud Functions triggers.');
console.log('');

const answer = await ask('  Type DEV to proceed (anything else aborts): ');
if (answer.trim() !== 'DEV') {
  console.log('Aborted. Nothing was changed.');
  process.exit(0);
}

console.log(`\n› Wiping all collections in ${DEV_PROJECT} …`);
try {
  run('firebase', ['firestore:delete', '--all-collections', '--project', DEV_PROJECT, '--force']);
} catch {
  console.error('✖ Wipe failed. Check `firebase login` and your access to dev.');
  process.exit(1);
}

console.log(`\n› Importing ${exportPath} into ${DEV_PROJECT} … (blocks until complete)`);
try {
  run('gcloud', ['firestore', 'import', exportPath, `--project=${DEV_PROJECT}`]);
} catch {
  console.error('\n✖ Import failed. If this is a permission error, grant dev read on the bucket.');
  console.error('  Cross-project import needs BOTH storage.buckets.get and storage.objects.get,');
  console.error('  so grant objectViewer AND legacyBucketReader (objectViewer alone is NOT enough —');
  console.error('  it lacks storage.buckets.get, which the import checks against the bucket root):');
  console.error(`    NUM=$(gcloud projects describe ${DEV_PROJECT} --format='value(projectNumber)')`);
  console.error('    for ROLE in roles/storage.objectViewer roles/storage.legacyBucketReader; do');
  console.error(`      gcloud storage buckets add-iam-policy-binding ${BUCKET} \\`);
  console.error('        --member="serviceAccount:service-$NUM@gcp-sa-firestore.iam.gserviceaccount.com" \\');
  console.error('        --role="$ROLE"');
  console.error('    done');
  process.exit(1);
}

console.log(`\n✔ Dev restored from ${exportPath}.`);
console.log('  Reminder: appSettings/devSettings now hold STAGING values, and chatSessions holds');
console.log('  staging user history — re-apply dev-specific config if needed.');
