#!/usr/bin/env node
// Task Pilot one-shot: WIPE a non-prod Firestore database and restore it from
// the newest managed export of another environment.
//
//   node scripts/restore-firestore.mjs --from prod    --to staging
//   node scripts/restore-firestore.mjs --from staging --to dev
//   node scripts/restore-firestore.mjs --from prod    --to dev
//
// DESTRUCTIVE — deletes ALL collections in the target, then imports a full copy
// of the source. It refuses to target prod, refuses any target whose resolved
// project id doesn't look like the environment you named, and makes you type the
// target name to confirm before the wipe.
//
// Replaces the former restore-staging-from-prod.mjs and restore-dev-from-staging.mjs,
// which were the same script modulo four values (source bucket, target project,
// guard, confirm word). The prod→dev route exists because the staging hop is
// pure latency when all you want is real-shaped data on dev-cloud: staging's copy
// IS prod's copy, so round-tripping it through a second export/import changes
// nothing except how long you wait.
//
// Why managed export/import: it does NOT fire Cloud Functions triggers, so the
// canon-match / icon-gen pipelines do not storm the target on the way in — they
// only run when you later exercise the change. It also doesn't bill document
// reads and handles subcollections.
//
// SCOPE — Firestore only. Cloud Storage (canon icons, recipe hero images) is NOT
// copied, and image URLs embed the bucket name of the project that generated
// them (see imaging/storageDownloadUrl.ts), so a restored target renders images
// out of the SOURCE project's bucket. That works today only because storage.rules
// grants public read on canon-icons/ and recipe-images/.
//
// After the restore, the target's `appSettings` / `devSettings` singletons hold
// the SOURCE's values (model selection, kill-switches) and `chatSessions` holds
// the source's user history. Re-apply any target-specific config you need.
//
// Auth: local `gcloud` (firestore import) + `firebase` (firestore:delete), both
// already used for deploys. The target's Firestore service agent must have read
// on the source's export bucket — the script prints the grant command if the
// import is denied.

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// Each environment's project id and (where it can act as a restore SOURCE) the
// bucket its managed exports land in. The env-var names are the ones the former
// scripts already honoured — note prod's is SALT_FS_EXPORT_BUCKET, not
// SALT_FS_PROD_EXPORT_BUCKET, kept as-is so existing setups keep working.
const ENVIRONMENTS = {
  prod: {
    label: 'PRODUCTION',
    project: process.env.SALT_PROD_PROJECT ?? 's2-prod-e46bd',
    bucketEnvVar: 'SALT_FS_EXPORT_BUCKET',
    bucket: process.env.SALT_FS_EXPORT_BUCKET,
    exportTask: 'Export Prod Firestore',
    // A restored project id must still look like the env you asked for — this is
    // the backstop against a mistyped SALT_*_PROJECT pointing the wipe somewhere
    // unexpected.
    expects: /prod/i,
  },
  staging: {
    label: 'staging',
    project: process.env.SALT_STAGING_PROJECT ?? 's2-stage-ccb22',
    bucketEnvVar: 'SALT_FS_STAGING_EXPORT_BUCKET',
    bucket: process.env.SALT_FS_STAGING_EXPORT_BUCKET,
    exportTask: 'Export Staging Firestore',
    expects: /stag/i,
  },
  dev: {
    label: 'dev-cloud',
    project: process.env.SALT_DEV_PROJECT ?? 's2-dev-eggman',
    // dev is never a restore source today (nothing downstream of it), so it has
    // no export bucket. Adding one is all it would take to make it one.
    exportTask: null,
    expects: /dev/i,
  },
};

// Allowed source→target pairs. prod is deliberately absent as a target: this
// script wipes what it touches, so "restore prod" must not be one keystroke away.
const ROUTES = new Set(['prod->staging', 'staging->dev', 'prod->dev']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inlineValue] = argv[i].split('=');
    if (flag !== '--from' && flag !== '--to') continue;
    out[flag.slice(2)] = inlineValue ?? argv[(i += 1)];
  }
  return out;
}

function usage(message) {
  console.error(`✖ ${message}\n`);
  console.error('Usage: node scripts/restore-firestore.mjs --from <env> --to <env>\n');
  console.error('Available routes:');
  for (const route of ROUTES) {
    const [from, to] = route.split('->');
    console.error(`  --from ${from} --to ${to}`.padEnd(34) + `(wipes ${ENVIRONMENTS[to].project})`);
  }
  process.exit(1);
}

const { from, to } = parseArgs(process.argv.slice(2));
if (!from || !to) usage('Both --from and --to are required.');
if (!ENVIRONMENTS[from]) usage(`Unknown source environment "${from}".`);
if (!ENVIRONMENTS[to]) usage(`Unknown target environment "${to}".`);
if (!ROUTES.has(`${from}->${to}`)) usage(`Route ${from} → ${to} is not allowed.`);

const source = ENVIRONMENTS[from];
const target = ENVIRONMENTS[to];
const BUCKET = source.bucket ?? `gs://${source.project}-firestore-exports`;

// ── Hard safety guards: this task wipes its target. The route table above is the
// primary defence; these re-check the RESOLVED project ids, which env vars can
// change out from under it. ──
if (/prod/i.test(target.project)) {
  console.error(`✖ Refusing to run: target "${target.project}" looks like production.`);
  console.error('  This task wipes its target; production is never a valid target.');
  process.exit(1);
}
if (target.project === source.project) {
  console.error(`✖ Refusing to run: source and target both resolve to "${target.project}".`);
  process.exit(1);
}
if (!target.expects.test(target.project)) {
  console.error(`✖ Refusing to run: target "${target.project}" is not an obvious ${to} project.`);
  console.error(`  Expected the project id to match ${target.expects}. Check SALT_*_PROJECT env vars.`);
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
  console.error(`✖ Could not list ${BUCKET}. Run "${source.exportTask}" first.`);
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
  console.error(`✖ No exports found in ${BUCKET}. Run "${source.exportTask}" first.`);
  process.exit(1);
}

const confirmWord = to.toUpperCase();

console.log('────────────────────────────────────────────────────────────');
console.log(` Restore ${target.label} Firestore from a ${source.label} export`);
console.log('────────────────────────────────────────────────────────────');
console.log(`  Target (WIPED, then restored): ${target.project}`);
console.log(`  Source export:                 ${exportPath}`);
console.log('');
console.log(`  This DELETES every collection in ${to}, then imports the export.`);
console.log('  Managed import does not fire Cloud Functions triggers.');
console.log('  Firestore only — Cloud Storage images still resolve to the source project.');
console.log('');

const answer = await ask(`  Type ${confirmWord} to proceed (anything else aborts): `);
if (answer.trim() !== confirmWord) {
  console.log('Aborted. Nothing was changed.');
  process.exit(0);
}

console.log(`\n› Wiping all collections in ${target.project} …`);
try {
  run('firebase', ['firestore:delete', '--all-collections', '--project', target.project, '--force']);
} catch {
  console.error(`✖ Wipe failed. Check \`firebase login\` and your access to ${to}.`);
  process.exit(1);
}

console.log(`\n› Importing ${exportPath} into ${target.project} … (blocks until complete)`);
try {
  run('gcloud', ['firestore', 'import', exportPath, `--project=${target.project}`]);
} catch {
  console.error(`\n✖ Import failed. If this is a permission error, grant ${to} read on the bucket.`);
  console.error('  Cross-project import needs BOTH storage.buckets.get and storage.objects.get,');
  console.error('  so grant objectViewer AND legacyBucketReader (objectViewer alone is NOT enough —');
  console.error('  it lacks storage.buckets.get, which the import checks against the bucket root):');
  console.error(`    NUM=$(gcloud projects describe ${target.project} --format='value(projectNumber)')`);
  console.error('    for ROLE in roles/storage.objectViewer roles/storage.legacyBucketReader; do');
  console.error(`      gcloud storage buckets add-iam-policy-binding ${BUCKET} \\`);
  console.error('        --member="serviceAccount:service-$NUM@gcp-sa-firestore.iam.gserviceaccount.com" \\');
  console.error('        --role="$ROLE"');
  console.error('    done');
  process.exit(1);
}

console.log(`\n✔ ${target.label} restored from ${exportPath}.`);
console.log(`  Reminder: appSettings/devSettings now hold ${source.label.toUpperCase()} values, and`);
console.log('  chatSessions holds that environment\'s user history — re-apply target-specific config if needed.');
