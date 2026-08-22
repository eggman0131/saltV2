#!/usr/bin/env node
// One-off: ask what kit every existing recipe needs (issue #882).
//
//   node scripts/backfill-recipe-kit.mjs --project dev     --dry-run
//   node scripts/backfill-recipe-kit.mjs --project dev     --apply
//   node scripts/backfill-recipe-kit.mjs --project staging --apply
//   node scripts/backfill-recipe-kit.mjs --project prod    --apply
//
// Kit inference shipped as a branch of `onRecipeWritten`, which only fires on a
// WRITE — so every recipe already in the library has no `kit` and would keep none
// until somebody happened to edit it. This is the pass that gives them one, so the
// "You'll need" strip is there from day one rather than appearing a recipe at a
// time over the next year.
//
// SAFE TO RE-RUN. A document that already carries `kitInferredAt` is skipped, so a
// second run reports "0 to ask" and writes nothing.
//
// ─── It bumps the nonce; it does NOT call the flow ────────────────────────────
//
// Two shapes were available: call `identifyRecipeKit` from here and PATCH the
// answer in, or stamp `kitRequestedAt` and let the trigger that already exists do
// the work. This does the second, for three reasons:
//
//   1. There would then be two implementations of "infer a recipe's kit" — this
//      one and the trigger's — and they would drift, exactly as the librarian and
//      extraction prompts did. The trigger is the only path in production; a
//      backfill that takes a different one is not testing what ships.
//   2. Genkit, the Gemini key and the model resolver all live in
//      `apps/cloud-functions`. Reaching them from a repo-root script means either
//      a new dependency or a copy of the flow — and issue #882 adds neither
//      (`backfill-recipe-attribution.mjs` takes the same stance about
//      `firebase-admin`).
//   3. Serialised + rate-limited here, one recipe at a time with a pause between,
//      so it is not a stampede: the trigger is per-document and Cloud Run scales
//      out, but a library's worth of AI calls arriving in one second is a spike
//      nobody asked for.
//
// The cost of that choice is that per-recipe reporting is about the REQUEST, not
// the answer: this script tells you the nonce landed, and the trigger's own logs
// (and, on failure, the PostHog report it files) tell you what the model said. It
// is the same bargain the "Redo kit" button in the app makes.
//
// ─── Why a field-level PATCH and not a document `set` ─────────────────────────
//
// Recipes are last-write-wins per WHOLE document (CLAUDE.md → Data model
// conventions), and `onRecipeWritten` writes back to the same document partially
// (`image`, `imageBrief`, and now `kit`). A full-document write from here would
// clobber whatever the trigger had written concurrently. So every write is a REST
// `PATCH` carrying `updateMask.fieldPaths=kitRequestedAt` and a one-field body:
// exactly one field changes and nothing else on the document is even sent.
//
// It deliberately does NOT write `updatedAt` — nothing about the recipe changed in
// any sense a human cares about, and moving `updatedAt` would reorder lists and
// make the client's stale-echo guard treat every recipe as freshly edited.
//
// The write fires `onRecipeWritten` once per recipe, which is the entire point.
// The image branch is unaffected: `imageNeedsGeneration` returns false when an
// image is already set, and also when it was null before and stays null with no
// `imageRequestedAt` bump — which is every document this script touches.
//
// ─── Auth ─────────────────────────────────────────────────────────────────────
//
// Your local `gcloud` active account (`gcloud auth login`), the same credential
// scripts/backfill-recipe-attribution.mjs, export-prod-firestore.mjs and
// restore-firestore.mjs use. Firestore REST rather than the Admin SDK because
// `firebase-admin` belongs to apps/cloud-functions and is not resolvable from the
// repo root.

import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';

// Mirrors scripts/backfill-recipe-attribution.mjs, including the env-var names, so
// the three environments are named the same way wherever they are named.
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

// Only `recipe` and `cocktail` are cookable (packages/domain → capabilities.ts).
// An outing has no method and a placeholder is a photograph and a title, so the
// trigger's kit branch skips them — asking here would be a write that produces
// nothing. Kept as a literal list rather than an import because a repo-root script
// cannot resolve `@salt/domain`; the trigger is the enforcer either way, so the
// worst a drift here can do is skip a kind that would have been skipped anyway.
const COOKABLE_KINDS = new Set(['recipe', 'cocktail']);

// One request every 1.5s. Slow enough that a library-sized run is a trickle rather
// than a spike of concurrent AI calls, fast enough that ~50 recipes takes a minute.
const PAUSE_MS = 1500;

// ─── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  // Dry run is the DEFAULT: `--apply` is the only thing that writes. The
  // attribution backfill defaults the other way, and this one is deliberately the
  // safer shape — every write here costs an AI call, so an accidental bare run
  // must cost nothing at all.
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--project') args.project = argv[(i += 1)];
    else die(`Unknown argument: ${arg}`);
  }
  return args;
}

function die(message) {
  console.error(`✖ ${message}`);
  console.error(
    '\nUsage: node scripts/backfill-recipe-kit.mjs --project <dev|staging|prod> [--apply]',
  );
  console.error('       (dry run by default — nothing is written without --apply)');
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

console.log(`Project : ${env.project} (${env.label})`);
console.log(`Mode    : ${args.apply ? 'APPLY — one AI call per recipe' : 'DRY RUN — nothing will be written'}\n`);

// ─── Scan ─────────────────────────────────────────────────────────────────────

// Masked to four small fields so a scan of the whole collection stays cheap — the
// recipes themselves (ingredients, steps, prose) are never fetched. `steps` is not
// masked in either: the trigger checks for an empty method itself, and pulling
// every method here to pre-empt it would defeat the point of the mask.
async function listRecipes() {
  const docs = [];
  let pageToken = '';
  do {
    const url =
      `${BASE}/recipes?pageSize=300` +
      '&mask.fieldPaths=kitInferredAt&mask.fieldPaths=title&mask.fieldPaths=kind' +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const page = await api(url);
    for (const doc of page.documents ?? []) {
      docs.push({
        id: doc.name.split('/').pop(),
        title: doc.fields?.title?.stringValue ?? '(untitled)',
        // Absent `kind` means `recipe` — the schema defaults it, and 21 of the
        // production recipes predate the field entirely.
        kind: doc.fields?.kind?.stringValue ?? 'recipe',
        inferred: doc.fields?.kitInferredAt !== undefined,
      });
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

const recipes = await listRecipes();
const notCookable = recipes.filter((r) => !COOKABLE_KINDS.has(r.kind));
const alreadyDone = recipes.filter((r) => COOKABLE_KINDS.has(r.kind) && r.inferred);
const toAsk = recipes.filter((r) => COOKABLE_KINDS.has(r.kind) && !r.inferred);

console.log(`Recipes found     : ${recipes.length}`);
console.log(`Not cookable      : ${notCookable.length} (skipped — nothing to get out)`);
console.log(`Already inferred  : ${alreadyDone.length} (skipped)`);
console.log(`To ask            : ${toAsk.length}\n`);

if (toAsk.length === 0) {
  console.log('✔ Nothing to do.');
  process.exit(0);
}

if (!args.apply) {
  for (const r of toAsk) console.log(`  would ask  ${r.id}  ${r.title}`);
  console.log(`\n✔ Dry run: ${toAsk.length} recipe(s) would be asked for a kit list.`);
  console.log('  Nothing was written. Re-run with --apply to do it.');
  process.exit(0);
}

// ─── Confirm (production only) ────────────────────────────────────────────────

if (args.project === 'prod') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question(`Type "production" to ask ${toAsk.length} recipe(s) in ${env.project}: `, (a) => {
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

let asked = 0;
const failures = [];
for (const r of toAsk) {
  const url = `${BASE}/recipes/${encodeURIComponent(r.id)}?updateMask.fieldPaths=kitRequestedAt`;
  try {
    await api(url, {
      method: 'PATCH',
      // The nonce the trigger's `kitNeedsInference` guard reads. Firestore's REST
      // encoding wants integers as strings; the field is a plain number on read.
      body: JSON.stringify({ fields: { kitRequestedAt: { integerValue: String(Date.now()) } } }),
    });
    asked += 1;
    console.log(`  asked   ${r.id}  ${r.title}`);
  } catch (err) {
    // Keep going: one unwritable document must not strand the rest, and the run is
    // re-runnable, so anything that fails here is simply picked up next time.
    failures.push({ id: r.id, message: err.message });
    console.error(`  FAILED  ${r.id}  ${r.title} — ${err.message}`);
  }
  await sleep(PAUSE_MS);
}

console.log(
  `\n✔ ${env.project}: asked ${asked}, skipped ${alreadyDone.length + notCookable.length}, failed ${failures.length}.`,
);
console.log('  The kit lists land as the trigger answers; watch the function logs for failures.');
process.exitCode = failures.length > 0 ? 1 : 0;
