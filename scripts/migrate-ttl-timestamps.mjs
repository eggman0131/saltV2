#!/usr/bin/env node
// One-off: convert the TTL fields Firestore's TTL machinery silently skips into
// the `Timestamp`s it acts on (issue #1008; the cause issue is #985).
//
//   node scripts/migrate-ttl-timestamps.mjs --project dev     --collection chatSessions --dry-run
//   node scripts/migrate-ttl-timestamps.mjs --project dev     --collection chatSessions --apply
//   node scripts/migrate-ttl-timestamps.mjs --project staging --collection chatSessions --apply
//   node scripts/migrate-ttl-timestamps.mjs --project prod    --collection chatSessions --apply --confirm production
//
// Writing to prod requires `--confirm production` AS A FLAG. There is no
// interactive prompt at all, deliberately: plenty of shells that look
// interactive do not give a child process a TTY on stdin (a Claude Code `!`
// command, CI, anything piped), and there `rl.question` never resolves — node
// exits on the unsettled await having printed a full write plan and written
// nothing, which reads exactly like a crash mid-write. A flag either is or is
// not on the command line.
//
// A TTL policy (`gcloud firestore fields ttls update`) only expires a document
// whose TTL field holds a `Timestamp`; a string, number or absent field is
// skipped in silence. `chatSessions.expiresAt` was written as an ISO-8601
// string from #206 until #1008, so every policy ever enabled was a no-op. The
// write paths now produce `Timestamp`s; this script converts the documents
// already written. Run it per project AFTER deploying the #1008 functions and
// PWA (a stale client re-writes a string; the tolerant read absorbs that, and a
// re-run converts it) and BEFORE enabling the policy — the procedure lives in
// docs/runbooks/ttl-policies.md.
//
// It converts the TYPE and never the instant: each recorded expiry string
// becomes the `timestampValue` of the same moment, echoed verbatim (an ISO-8601
// UTC string is already valid RFC 3339, which is what the REST API takes). The
// 31 pre-#939 sentinel docs (`9999-12-31T23:59:59.999Z`) convert verbatim too —
// within Firestore's Timestamp range, still effectively unexpiring until their
// next conversational turn restamps them, exactly as #939 designed. A migration
// that silently shortened a recorded expiry would delete data nobody agreed to
// delete.
//
// SAFE TO RE-RUN. A document whose TTL field already holds a `timestampValue`
// is reported and skipped, so a second run writes nothing — and mopping up
// after a stale client is exactly a re-run.
//
// ─── Why a field-level PATCH ─────────────────────────────────────────────────
//
// Chat sessions are last-write-wins per WHOLE document (CLAUDE.md → Data model
// conventions) and are being written by live clients while this runs. Every
// write here is a REST `PATCH` carrying `updateMask.fieldPaths=<ttl field>` and
// a body holding nothing but that field, so a concurrent full-doc client write
// is never clobbered and this script never touches `messages` — the fattest
// field in the app. (The read is masked to the TTL field for the same reason:
// there is no cause to pull message history over the wire at all.)
//
// ─── Auth ────────────────────────────────────────────────────────────────────
//
// Your local `gcloud` active account (`gcloud auth login`), the same credential
// scripts/fix-recipe-range-timers.mjs and scripts/export-prod-firestore.mjs
// use. Firestore REST rather than the Admin SDK because `firebase-admin`
// belongs to apps/cloud-functions and is not resolvable from the repo root;
// shelling to `gcloud` for a token is the established idiom for this folder.

import { execFileSync } from 'node:child_process';

// Mirrors scripts/fix-recipe-range-timers.mjs, including the env-var names,
// so the three environments are named the same way wherever they are named.
const ENVIRONMENTS = {
  prod: {
    label: 'PRODUCTION',
    project: process.env.SALT_PROD_PROJECT ?? 's2-prod-e46bd',
    expects: /prod/i,
  },
  staging: {
    label: 'staging',
    project: process.env.SALT_STAGING_PROJECT ?? 's2-stage-ccb22',
    expects: /stag/i,
  },
  dev: {
    label: 'dev-cloud',
    project: process.env.SALT_DEV_PROJECT ?? 's2-dev-eggman',
    expects: /dev/i,
  },
};

// One entry per collection with a TTL field to convert. `fields` lists what the
// masked read fetches and the masked write patches; `plan` inspects one raw
// REST document and returns either the exact fields to write or the reason it
// is being left alone.
const COLLECTIONS = {
  chatSessions: {
    fields: ['expiresAt'],
    plan(doc) {
      const node = doc.fields?.expiresAt;
      if (node === undefined) return { skip: 'has no expiresAt field at all' };
      if (node.timestampValue !== undefined) return { skip: null }; // already converted
      if (node.stringValue === undefined) {
        return { skip: `expiresAt holds ${Object.keys(node)[0] ?? 'nothing'}, not a string` };
      }
      const iso = node.stringValue;
      if (!Number.isFinite(Date.parse(iso))) {
        return { skip: `expiresAt "${iso}" does not parse as a date` };
      }
      // Same instant, new type: the stored ISO-8601 UTC string is already valid
      // RFC 3339, so it is echoed verbatim rather than re-serialised.
      return { write: { expiresAt: { timestampValue: iso } }, detail: iso };
    },
  },
  // timerDeliveries lands with Phase 2 of #1008.
};

// ─── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--project') args.project = argv[(i += 1)];
    else if (arg === '--collection') args.collection = argv[(i += 1)];
    // Non-interactive confirmation for `--project prod`; see the gate below.
    else if (arg === '--confirm') args.confirm = argv[(i += 1)];
    else die(`Unknown argument: ${arg}`);
  }
  return args;
}

function die(message) {
  console.error(`✖ ${message}`);
  console.error(
    '\nUsage: node scripts/migrate-ttl-timestamps.mjs --project <dev|staging|prod>' +
      ' --collection <chatSessions> (--dry-run | --apply)' +
      '\n       writing to prod additionally requires: --confirm production',
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

// No default project, deliberately: the environment you are writing to is never
// something this script should assume.
if (!args.project) die('--project is required (dev | staging | prod). There is no default.');
const env = ENVIRONMENTS[args.project];
if (!env) die(`Unknown project "${args.project}". Expected one of: dev, staging, prod.`);
// Backstop against a mistyped SALT_*_PROJECT pointing the write somewhere
// unexpected — the same guard restore-firestore.mjs applies.
if (!env.expects.test(env.project)) {
  die(`Project id "${env.project}" does not look like ${args.project}. Refusing to write to it.`);
}
if (!args.collection) {
  die(`--collection is required (${Object.keys(COLLECTIONS).join(' | ')}). There is no default.`);
}
const spec = COLLECTIONS[args.collection];
if (!spec) {
  die(
    `Unknown collection "${args.collection}". Expected one of: ${Object.keys(COLLECTIONS).join(', ')}.`,
  );
}
// Writing is opt-in rather than the default: --apply must be typed, so a run with
// a forgotten flag reads the collection and reports instead of rewriting it.
if (args.dryRun && args.apply) die('Pass either --dry-run or --apply, not both.');
if (!args.dryRun && !args.apply) die('Pass --dry-run to preview, or --apply to write.');

// ─── The prod gate — a flag, never a prompt (see the header) ─────────────────

if (args.project === 'prod' && args.apply) {
  if (args.confirm === undefined) {
    console.error('✖ Writing to PRODUCTION needs confirmation, passed as a flag:');
    console.error(
      `    node scripts/migrate-ttl-timestamps.mjs --project prod --collection ${args.collection} --apply --confirm production`,
    );
    console.error('  Nothing was written.');
    process.exit(1);
  }
  if (args.confirm !== 'production') {
    console.error(`✖ --confirm must be exactly "production" (got "${args.confirm}").`);
    console.error('  Nothing written.');
    process.exit(1);
  }
}

// ─── Firestore REST ───────────────────────────────────────────────────────────

const BASE = `https://firestore.googleapis.com/v1/projects/${env.project}/databases/(default)/documents`;

let token;
try {
  token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
} catch {
  die('Could not get a gcloud access token. Run `gcloud auth login` first.');
}

async function api(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const path = url.split('/documents')[1];
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  }
  return res.json();
}

console.log(`Project    : ${env.project} (${env.label})`);
console.log(`Collection : ${args.collection}`);
console.log(`Mode       : ${args.dryRun ? 'DRY RUN — nothing will be written' : 'WRITE'}\n`);

// ─── Scan ─────────────────────────────────────────────────────────────────────

// Masked to the TTL field(s): the rest of the document — including chat message
// history — is never fetched.
async function listDocuments() {
  const docs = [];
  const mask = spec.fields.map((f) => `mask.fieldPaths=${f}`).join('&');
  let pageToken = '';
  do {
    const url =
      `${BASE}/${args.collection}?pageSize=300&${mask}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const page = await api(url);
    for (const doc of page.documents ?? []) {
      docs.push({ id: doc.name.split('/').pop(), fields: doc.fields });
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

const documents = await listDocuments();

const planned = [];
const anomalies = [];
let alreadyConverted = 0;
for (const doc of documents) {
  const outcome = spec.plan(doc);
  if (outcome.write) planned.push({ id: doc.id, write: outcome.write, detail: outcome.detail });
  else if (outcome.skip === null) alreadyConverted += 1;
  else anomalies.push({ id: doc.id, reason: outcome.skip });
}

console.log(`Documents scanned   : ${documents.length}`);
console.log(`Already a Timestamp : ${alreadyConverted}`);
console.log(`To convert          : ${planned.length}\n`);

for (const doc of planned) {
  console.log(`  ${doc.id}  →  ${doc.detail}`);
}

if (anomalies.length) {
  console.log('\n  Left alone (decide these by hand):');
  for (const a of anomalies) console.log(`      ${a.id}: ${a.reason}`);
}

if (planned.length === 0) {
  console.log('\n✔ Nothing to do.');
  process.exit(0);
}

if (args.dryRun) {
  console.log(`\n✔ Dry run: ${planned.length} document(s) would convert. Nothing was written.`);
  process.exit(0);
}

// ─── Write ────────────────────────────────────────────────────────────────────

let converted = 0;
const failures = [];
for (const doc of planned) {
  const mask = Object.keys(doc.write)
    .map((f) => `updateMask.fieldPaths=${f}`)
    .join('&');
  const url = `${BASE}/${args.collection}/${encodeURIComponent(doc.id)}?${mask}`;
  try {
    await api(url, { method: 'PATCH', body: JSON.stringify({ fields: doc.write }) });
    converted += 1;
  } catch (err) {
    // Keep going: one unwritable document must not strand the rest, and the run
    // is re-runnable, so anything that fails here is simply picked up next time.
    failures.push({ id: doc.id, message: err.message });
    console.error(`  FAILED  ${doc.id} — ${err.message}`);
  }
}

console.log(`\n✔ ${env.project}/${args.collection}: converted ${converted}, failed ${failures.length}.`);
process.exit(failures.length > 0 ? 1 : 0);
