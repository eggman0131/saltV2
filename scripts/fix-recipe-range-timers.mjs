#!/usr/bin/env node
// One-off: move every range timer onto the LOWER bound of the range its step
// states, which is what STEP_RULES has always asked for.
//
//   node scripts/fix-recipe-range-timers.mjs --project dev     --dry-run
//   node scripts/fix-recipe-range-timers.mjs --project dev     --apply
//   node scripts/fix-recipe-range-timers.mjs --project staging --apply
//   node scripts/fix-recipe-range-timers.mjs --project prod    --apply
//
// Writing to prod asks you to type "production". Where stdin is not a terminal
// (a Claude Code `!` command, CI, anything piped) type it as a flag instead:
//   node scripts/fix-recipe-range-timers.mjs --project prod --apply --confirm production
//
// `stepRules.ts` → STEP_RULES: "When the source gives a RANGE ('simmer for 10–15
// minutes'), take the LOWER bound — 10, not 15 — so the timer goes off when the
// cook should START CHECKING rather than when the dish is already done." Recipes
// written before that clause landed took the upper bound instead, and a prove or
// brine timer that fires late is the one kind of wrong timer that costs a dish.
// An audit of production on 2026-08-23 found 19 such timers across 13 recipes —
// every single range timer in the library, all wrong the same way.
//
// It changes ONLY the number. The prose keeps its range verbatim, which is also
// what STEP_RULES asks for: the range stays in the text the cook is reading, and
// is deliberately not stored anywhere else.
//
// SAFE TO RE-RUN. A timer is rewritten only when it equals the UPPER bound of a
// range in its own step text, so once it holds the lower bound it no longer
// matches and a second run reports "0 to fix" and writes nothing.
//
// ─── Why a field-level PATCH, and why the raw REST document ──────────────────
//
// Recipes are last-write-wins per WHOLE document (CLAUDE.md → Data model
// conventions) and `onRecipeWritten` writes back to the same document partially
// (`image`, `imageBrief`, `kit`). A full-document write from here would clobber
// whatever the trigger had written concurrently, so every write is a REST `PATCH`
// carrying `updateMask.fieldPaths=steps` and a body holding nothing but `steps` —
// the one field being edited.
//
// `steps` is an array, and Firestore has no way to patch one element of one, so
// the whole array is necessarily rewritten. That is why this script mutates the
// RAW REST value tree rather than decoding to plain JS and re-encoding: a decode
// round-trip would have to guess `integerValue` vs `doubleValue` for every number
// and `nullValue` vs absent for every optional, and would silently rewrite step
// ids, notes and timer labels it was never asked to touch. Editing the raw tree
// in place means exactly one leaf changes and every other byte is echoed back as
// Firestore itself sent it.
//
// It deliberately does NOT write `updatedAt`. The recipes did not change in any
// sense a human cares about, and moving `updatedAt` would reorder lists and make
// the client's stale-echo guard (`recipeService.applySnapshot`) treat every
// recipe as freshly edited. Same call, same reason, as
// scripts/backfill-recipe-attribution.mjs.
//
// The write DOES fire `onRecipeWritten` once per fixed recipe, and both of its
// branches are no-ops for it:
//   - `imageNeedsGeneration` returns false the moment `image` is non-null, which
//     it is on every recipe in production.
//   - `kitNeedsInference` returns false on an update whose `kitRequestedAt` nonce
//     is unchanged — this script never touches that field. No AI is called and no
//     kit is inferred. If you WANT kit inference, that is a different pass:
//     scripts/backfill-recipe-kit.mjs.
//
// ─── Auth ────────────────────────────────────────────────────────────────────
//
// Your local `gcloud` active account (`gcloud auth login`), the same credential
// scripts/backfill-recipe-attribution.mjs and scripts/export-prod-firestore.mjs
// use. Firestore REST rather than the Admin SDK because `firebase-admin` belongs
// to apps/cloud-functions and is not resolvable from the repo root; shelling to
// `gcloud` for a token is the established idiom for everything in this folder.

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// Mirrors scripts/backfill-recipe-attribution.mjs, including the env-var names,
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

// ─── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--project') args.project = argv[(i += 1)];
    // Non-interactive confirmation for `--project prod`; see the gate below.
    else if (arg === '--confirm') args.confirm = argv[(i += 1)];
    else die(`Unknown argument: ${arg}`);
  }
  return args;
}

function die(message) {
  console.error(`✖ ${message}`);
  console.error(
    '\nUsage: node scripts/fix-recipe-range-timers.mjs --project <dev|staging|prod> (--dry-run | --apply)' +
      '\n       add --confirm production to write to prod without an interactive prompt',
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
// Writing is opt-in rather than the default: --apply must be typed, so a run with
// a forgotten flag reads the library and reports instead of rewriting it.
if (args.dryRun && args.apply) die('Pass either --dry-run or --apply, not both.');
if (!args.dryRun && !args.apply) die('Pass --dry-run to preview, or --apply to write.');

// ─── Detection ────────────────────────────────────────────────────────────────

// "10 to 12 minutes", "20–25 minutes", "1-2 mins", "12 to 16 hours". The unit is
// required: a bare "3 to 4" is a quantity or a step reference, never a duration.
const RANGE = /(\d+)\s*(?:to|–|—|-)\s*(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/gi;

function rangesIn(text) {
  const out = [];
  for (const m of text.matchAll(RANGE)) {
    const perUnit = /^h/i.test(m[3]) ? 60 : 1;
    const low = Number(m[1]) * perUnit;
    const high = Number(m[2]) * perUnit;
    // "20-25" is a range; "5-5" and a descending "20-15" are not, and neither is
    // anything this script should be interpreting.
    if (high > low) out.push({ low, high, quote: m[0].trim() });
  }
  return out;
}

// Firestore encodes a whole number as `integerValue` (a STRING) and anything else
// as `doubleValue` (a number). Read either; write back using the key the document
// already used, so a fix never silently changes a field's stored type.
function readNumber(node) {
  if (node == null) return null;
  if (node.integerValue !== undefined) return Number(node.integerValue);
  if (node.doubleValue !== undefined) return node.doubleValue;
  return null;
}

function writeNumber(node, value) {
  if (node.integerValue !== undefined) node.integerValue = String(value);
  else node.doubleValue = value;
}

/**
 * Mutates `stepsNode` (a raw Firestore arrayValue) in place and returns one entry
 * per timer it changed. Anything it declines to change is returned separately so
 * the run reports what it left alone rather than staying silent about it.
 */
function fixSteps(stepsNode) {
  const changed = [];
  const skipped = [];

  const steps = stepsNode?.arrayValue?.values ?? [];
  steps.forEach((step, index) => {
    const fields = step?.mapValue?.fields;
    if (!fields) return;

    // `timer` is nullable on the schema, so an absent timer arrives as
    // `{ nullValue: 'NULL_VALUE' }` and has no mapValue to look inside.
    const durationNode = fields.timer?.mapValue?.fields?.durationMinutes;
    const stored = readNumber(durationNode);
    if (stored === null) return;

    const text = fields.text?.stringValue ?? '';
    const candidates = rangesIn(text).filter((r) => r.high === stored);
    if (candidates.length === 0) return;

    // Two ranges in one step can both end on the stored number ("bake 20–25
    // minutes, then rest 15–25"). If they disagree about where the range STARTS
    // there is no way to tell which one the timer belongs to, so leave it for a
    // human rather than guessing — the step is named in the output.
    const lows = new Set(candidates.map((r) => r.low));
    if (lows.size > 1) {
      skipped.push({
        ordinal: index + 1,
        stored,
        reason: `matches ${candidates.length} ranges with different lower bounds (${candidates
          .map((r) => `"${r.quote}"`)
          .join(', ')})`,
      });
      return;
    }

    const { low, quote } = candidates[0];
    writeNumber(durationNode, low);
    changed.push({ ordinal: index + 1, from: stored, to: low, quote });
  });

  return { changed, skipped };
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
console.log(`Mode    : ${args.dryRun ? 'DRY RUN — nothing will be written' : 'WRITE'}\n`);

// ─── Scan ─────────────────────────────────────────────────────────────────────

// Masked to the two fields this script reads. `steps` is the bulk of a recipe, but
// it is also the field being edited — the ingredient list, prose and image fields
// are never fetched.
async function listRecipes() {
  const docs = [];
  let pageToken = '';
  do {
    const url =
      `${BASE}/recipes?pageSize=300` +
      '&mask.fieldPaths=steps&mask.fieldPaths=title' +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const page = await api(url);
    for (const doc of page.documents ?? []) {
      docs.push({
        id: doc.name.split('/').pop(),
        title: doc.fields?.title?.stringValue ?? '(untitled)',
        stepsNode: doc.fields?.steps,
      });
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

const recipes = await listRecipes();

const planned = [];
const ambiguous = [];
for (const recipe of recipes) {
  const { changed, skipped } = fixSteps(recipe.stepsNode);
  if (changed.length) planned.push({ ...recipe, changed });
  if (skipped.length) ambiguous.push({ ...recipe, skipped });
}

const timerCount = planned.reduce((total, r) => total + r.changed.length, 0);

console.log(`Recipes scanned : ${recipes.length}`);
console.log(`Recipes to fix  : ${planned.length}`);
console.log(`Timers to fix   : ${timerCount}\n`);

for (const recipe of planned) {
  console.log(`  ${recipe.title}`);
  for (const c of recipe.changed) {
    console.log(`      step ${c.ordinal}: "${c.quote}" — ${c.from}m → ${c.to}m`);
  }
}

if (ambiguous.length) {
  console.log('\n  Left alone (ambiguous — decide these by hand):');
  for (const recipe of ambiguous) {
    for (const s of recipe.skipped) {
      console.log(`      ${recipe.title} step ${s.ordinal} (${s.stored}m): ${s.reason}`);
    }
  }
}

if (timerCount === 0) {
  console.log('\n✔ Nothing to do.');
  process.exit(0);
}

if (args.dryRun) {
  console.log(`\n✔ Dry run: ${timerCount} timer(s) across ${planned.length} recipe(s) would move.`);
  console.log('  Nothing was written.');
  process.exit(0);
}

// ─── Confirm (production only) ────────────────────────────────────────────────

// Two ways to confirm, because there are two ways this gets run.
//
// Interactively, you type the word. But plenty of shells that look interactive
// do NOT give a child process a TTY on stdin — a Claude Code `!` command, a CI
// step, anything piping input. There, `rl.question` never resolves, node exits on
// the unsettled await, and the run dies at the prompt having printed a full plan
// and done nothing. That reads exactly like a crash mid-write, which is the worst
// possible ambiguity for a script that writes to production. So when stdin is not
// a TTY the gate refuses up front and names the flag that satisfies it, instead of
// asking a question nobody can answer.
if (args.project === 'prod') {
  if (args.confirm !== undefined) {
    if (args.confirm !== 'production') {
      console.error(`✖ --confirm must be exactly "production" (got "${args.confirm}").`);
      console.error('  Nothing written.');
      process.exit(1);
    }
    console.log(`\nConfirmed via --confirm: moving ${timerCount} timer(s) in ${env.project}.\n`);
  } else if (!process.stdin.isTTY) {
    console.error('\n✖ Writing to PRODUCTION needs confirmation, and stdin is not a terminal');
    console.error('  so there is nothing to type into. Nothing was written.\n');
    console.error('  Re-run in an interactive terminal, or pass the confirmation as a flag:');
    console.error(
      `    node scripts/fix-recipe-range-timers.mjs --project prod --apply --confirm production`,
    );
    process.exit(1);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) =>
      rl.question(`\nType "production" to move ${timerCount} timer(s) in ${env.project}: `, (a) => {
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
}

// ─── Write ────────────────────────────────────────────────────────────────────

let fixed = 0;
const failures = [];
for (const recipe of planned) {
  const url = `${BASE}/recipes/${encodeURIComponent(recipe.id)}?updateMask.fieldPaths=steps`;
  try {
    await api(url, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { steps: recipe.stepsNode } }),
    });
    fixed += recipe.changed.length;
    console.log(`  fixed  ${recipe.changed.length} timer(s)  ${recipe.title}`);
  } catch (err) {
    // Keep going: one unwritable document must not strand the rest, and the run
    // is re-runnable, so anything that fails here is simply picked up next time.
    failures.push({ id: recipe.id, message: err.message });
    console.error(`  FAILED  ${recipe.title} — ${err.message}`);
  }
}

console.log(`\n✔ ${env.project}: moved ${fixed} timer(s), failed ${failures.length}.`);
process.exit(failures.length > 0 ? 1 : 0);
