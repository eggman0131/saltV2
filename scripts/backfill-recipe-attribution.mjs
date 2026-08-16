#!/usr/bin/env node
// One-off: stamp `createdBy` on every recipe document that has none (issue #845).
//
//   node scripts/backfill-recipe-attribution.mjs --project dev     --member you@example.com --dry-run
//   node scripts/backfill-recipe-attribution.mjs --project dev     --member you@example.com
//   node scripts/backfill-recipe-attribution.mjs --project staging --member you@example.com
//   node scripts/backfill-recipe-attribution.mjs --project prod    --member you@example.com
//
// Attribution shipped in Phase 1 as `z.string().default('')`, so every recipe
// already in the library reads back with an empty `createdBy` and shows no chip.
// This is the pass that gives them one, so the chip is there from day one rather
// than appearing only on recipes added from now on.
//
// SAFE TO RE-RUN. A document that already carries a non-empty `createdBy` is
// skipped, so a second run reports "0 to stamp" and writes nothing.
//
// ─── Why a field-level PATCH and not a document `set` ────────────────────────
//
// Recipes are last-write-wins per WHOLE document (CLAUDE.md → Data model
// conventions), and `onRecipeWritten` writes back to the same document
// partially (`image`, `imageBrief`). A full-document write from here would
// clobber whatever the trigger had written concurrently. So every write is a
// REST `PATCH` carrying `updateMask.fieldPaths=createdBy` and a one-field body:
// exactly one field changes and nothing else on the document is even sent.
//
// It deliberately does NOT write `updatedAt` — the recipes did not change in any
// sense a human cares about, and moving `updatedAt` would reorder lists and make
// the client's stale-echo guard (`recipeService.applySnapshot`) treat every
// recipe as freshly edited.
//
// It deliberately does NOT write `lastEditedBy` either. Nobody knows who last
// edited these, and inventing an answer is worse than silence: the recipe page
// only shows "· edited by Y" when Y differs from the creator, so leaving it
// blank reads correctly as "added by X" and nothing more.
//
// The write DOES fire `onRecipeWritten` once per stamped recipe, which is
// harmless: `imageNeedsGeneration` returns false when `image` is already set,
// and also when it was null before and stays null with no `imageRequestedAt`
// bump — which is every document this script touches. No hero is regenerated,
// no review flag moves, nothing is re-canonicalised.
//
// ─── Auth ────────────────────────────────────────────────────────────────────
//
// Your local `gcloud` active account (`gcloud auth login`), the same credential
// scripts/export-prod-firestore.mjs and scripts/restore-firestore.mjs use. This
// talks to the Firestore REST API rather than the Admin SDK because
// `firebase-admin` belongs to apps/cloud-functions and is not resolvable from
// the repo root — and issue #845 adds no new dependency. Shelling to `gcloud`
// for a token is the established idiom for everything in this folder.

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// Mirrors scripts/restore-firestore.mjs, including the env-var names, so the
// three environments are named the same way wherever they are named.
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

// ─── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--project') args.project = argv[(i += 1)];
    else if (arg === '--member') args.member = argv[(i += 1)];
    else die(`Unknown argument: ${arg}`);
  }
  return args;
}

function die(message) {
  console.error(`✖ ${message}`);
  console.error(
    '\nUsage: node scripts/backfill-recipe-attribution.mjs --project <dev|staging|prod> --member <email> [--dry-run]',
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
if (!args.member) die('--member <email> is required: whose name to stamp.');

// The same normalisation the app applies (`normaliseMemberEmail`), because the
// member document id IS the normalised email.
const memberId = args.member.trim().toLowerCase();

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

// ─── The name to stamp ────────────────────────────────────────────────────────

// Read from the member document rather than taking a name on the command line:
// the chip has to read the same string the app writes, and `Member.name` is the
// only place that string is defined.
let name;
try {
  const doc = await api(`${BASE}/members/${encodeURIComponent(memberId)}`);
  name = doc.fields?.name?.stringValue?.trim();
} catch (err) {
  die(`Could not read members/${memberId} in ${env.project}: ${err.message}`);
}
if (!name) die(`members/${memberId} exists in ${env.project} but has no \`name\`.`);

console.log(`Project : ${env.project} (${env.label})`);
console.log(`Stamping: "${name}"  (from members/${memberId})`);
console.log(`Mode    : ${args.dryRun ? 'DRY RUN — nothing will be written' : 'WRITE'}\n`);

// ─── Scan ─────────────────────────────────────────────────────────────────────

// Masked to two fields so a scan of the whole collection stays small — the
// recipes themselves (ingredients, steps, prose) are never fetched.
async function listRecipes() {
  const docs = [];
  let pageToken = '';
  do {
    const url =
      `${BASE}/recipes?pageSize=300` +
      '&mask.fieldPaths=createdBy&mask.fieldPaths=title' +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const page = await api(url);
    for (const doc of page.documents ?? []) {
      docs.push({
        id: doc.name.split('/').pop(),
        title: doc.fields?.title?.stringValue ?? '(untitled)',
        createdBy: doc.fields?.createdBy?.stringValue ?? '',
      });
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

const recipes = await listRecipes();
// Absent and empty-string are the same state — "no attribution on record" — so
// both are stamped, and anything already attributed is left exactly as it is.
const toStamp = recipes.filter((r) => !r.createdBy);
const already = recipes.length - toStamp.length;

console.log(`Recipes found      : ${recipes.length}`);
console.log(`Already attributed : ${already} (skipped)`);
console.log(`To stamp           : ${toStamp.length}\n`);

if (toStamp.length === 0) {
  console.log('✔ Nothing to do.');
  process.exit(0);
}

if (args.dryRun) {
  for (const r of toStamp) console.log(`  would stamp  ${r.id}  ${r.title}`);
  console.log(`\n✔ Dry run: ${toStamp.length} recipe(s) would be stamped "${name}".`);
  console.log('  Nothing was written.');
  process.exit(0);
}

// ─── Confirm (production only) ────────────────────────────────────────────────

if (args.project === 'prod') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question(`Type "production" to stamp ${toStamp.length} recipe(s) in ${env.project}: `, (a) => {
      rl.close();
      resolve(a.trim());
    }),
  );
  if (answer !== 'production') {
    console.error('✖ Not confirmed. Nothing written.');
    process.exit(1);
  }
  console.log('');
}

// ─── Write ────────────────────────────────────────────────────────────────────

let stamped = 0;
const failures = [];
for (const r of toStamp) {
  const url = `${BASE}/recipes/${encodeURIComponent(r.id)}?updateMask.fieldPaths=createdBy`;
  try {
    await api(url, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { createdBy: { stringValue: name } } }),
    });
    stamped += 1;
    console.log(`  stamped  ${r.id}  ${r.title}`);
  } catch (err) {
    // Keep going: one unwritable document must not strand the rest, and the run
    // is re-runnable, so anything that fails here is simply picked up next time.
    failures.push({ id: r.id, message: err.message });
    console.error(`  FAILED   ${r.id}  ${r.title} — ${err.message}`);
  }
}

console.log(`\n✔ ${env.project}: stamped ${stamped}, skipped ${already}, failed ${failures.length}.`);
process.exit(failures.length > 0 ? 1 : 0);
