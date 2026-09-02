/**
 * Source guard: the recipe-load prologue is written once (issue #970).
 *
 * Three AI flows opened the same way — fetch `recipes/{id}`, throw
 * `not-found` if it is absent, `RecipeSchema.safeParse` it, throw
 * `failed-precondition` if that fails. Two of the three were byte-identical.
 * Nothing had broken because of it, which is exactly why it needed a guard
 * rather than a fix: the next flow needing a recipe copies whichever of the
 * copies it happens to see, and the copies drift one edit at a time.
 *
 * What drift would cost. The error CODE is not cosmetic. `classifyCallableError`
 * (packages/adapters/firebase-sync/src/callableErrors.ts) reads it in the browser
 * and turns `not-found` and `failed-precondition` into different things the user
 * is told. A fourth copy answering "is a missing recipe not-found or
 * failed-precondition?" differently is a user-visible inconsistency that no type,
 * no lint rule and no existing test would notice.
 *
 * Extracting `flows/loadRecipe.ts` does not stop a fourth hand-written copy, so
 * per CLAUDE.md Hard rule 12 the invariant is made mechanical here instead of
 * asserted in a comment nothing enforces.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The scan surface is the whole `src` tree, WALKED — never a hand-kept list
 *    (UT-E1). A flow written next year is covered on the day it is written.
 *  - The two messages are IMPORTED from the module that owns them, not restated
 *    (UT-E1). Reword one and the guard moves with it; delete `loadRecipe.ts` and
 *    this file fails to import, which is the red the issue asked for.
 *  - Every matcher is exercised against a synthetic violation it must catch AND
 *    a near-miss it must not (UT-E2), so a regex broken by a later edit fails
 *    here rather than passing everything.
 *  - It asserts that the three flows still CONSUME the helper (UT-E2). A flow
 *    that quietly re-inlines the prologue trips this even if its copy is spelled
 *    differently enough to slip past the structural matcher.
 *  - It matches identifiers and call shapes — `RecipeSchema`, `new HttpsError`,
 *    the collection name as a string literal — never a line number and never the
 *    wording of a comment (UT-E3).
 *
 * ── The honest boundary: four things this guard CANNOT see ───────────────────
 *
 *  1. A copy that reaches Firestore through a variable (`const c = 'recipes';`)
 *     or a re-exported constant. The collection name has to appear as a literal
 *     in the file for the structural matcher to fire.
 *  2. A copy whose throw is built in a DIFFERENT file — a local `fail()` helper
 *     imported from elsewhere — since `new HttpsError` must appear in the same
 *     file as the read.
 *  3. A copy that validates with something other than `RecipeSchema` (a hand-
 *     rolled shape check, or `as RecipeDoc`). That is a worse defect and a
 *     different one; the Zod conventions in CLAUDE.md are what police it.
 *  4. A STALE copy of a message: if the constants are reworded and an old
 *     spelling survives somewhere, the message matcher below is looking for the
 *     new words and will not find the old.
 *
 * None of those is hypothetical-but-covered. They are gaps, stated so the next
 * reader knows what a green run here does and does not prove.
 *
 * ── The allowlist ────────────────────────────────────────────────────────────
 *
 * Eleven other sites in this tree read a recipe and are deliberately NOT users
 * of the helper: each is non-throwing on purpose, and the reason is at the site.
 * Only those that actually trip a matcher need an entry below — an allowlist
 * longer than the offences it excuses is its own kind of stale.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { RECIPE_NOT_FOUND_MESSAGE, RECIPE_UNREADABLE_MESSAGE } from '../src/flows/loadRecipe.js';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../src');

/** Where the prologue is allowed to live, as a path under `src`. */
const HELPER = 'flows/loadRecipe.ts';

/** Every `.ts` file under `src`, found by walking — never by a hand-kept list. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

// Strip comments so a MENTION of the prologue in prose — this refactor left
// several, naming the helper the site now delegates to — never counts as a copy
// of it.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Scanned {
  /** Path under `src`, `/`-joined — what a failure names. */
  readonly path: string;
  readonly code: string;
}

const files: Scanned[] = walk(srcDir).map((full) => ({
  path: relative(srcDir, full).split(sep).join('/'),
  code: stripComments(readFileSync(full, 'utf8')),
}));

// ─── Matcher one: the prologue written out by hand ────────────────────────────

/**
 * All four must hold for a file to offend, and that conjunction is the design:
 * each pattern alone is ordinary (dozens of files throw an `HttpsError`; several
 * name the `recipes` collection), and together they are the prologue.
 */
const PROLOGUE: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: 'names the `recipes` collection', pattern: /['"]recipes['"]/ },
  { what: 'reads one document by id', pattern: /\.doc\s*\(|\bloadDoc\s*\(/ },
  { what: 'validates it with RecipeSchema', pattern: /\bRecipeSchema\s*\.\s*safeParse\s*\(/ },
  {
    what: 'and throws a callable error for the result',
    pattern: /new\s+HttpsError\s*\(\s*['"](?:not-found|failed-precondition)['"]/,
  },
];

const writesPrologue = (code: string): boolean =>
  PROLOGUE.every(({ pattern }) => pattern.test(code));

/**
 * Sites excused from the structural matcher, with the reason each differs.
 *
 * `getImagePrompt` is the only one that trips it today. It is not a fourth copy:
 * it collapses missing-and-invalid into ONE `not-found` with its own message
 * ("No such recipe."), as one arm of a six-collection switch whose other five
 * arms do exactly the same for canon items, product forms, kitchen tools and
 * equipment icons. Routing its recipe arm through `requireRecipe` would make one
 * arm of that switch answer differently from the other five, which is a worse
 * inconsistency than the one this guard exists to prevent.
 */
const ALLOWED: readonly { readonly path: string; readonly why: string }[] = [
  {
    path: 'callables/getImagePrompt.ts',
    why: 'one arm of a six-collection switch; deliberately collapses missing+invalid into a single not-found with its own message, as the other five arms do',
  },
];

const allowedPaths = new Set(ALLOWED.map((a) => a.path));

// ─── Matcher two: the two user-facing messages ────────────────────────────────

/**
 * Derived from the exported constants, never restated (UT-E1). These are the
 * decision that reaches the user, so a second spelling of either is drift even
 * if the code around it is shaped differently from the prologue above.
 */
const MESSAGES: readonly { readonly name: string; readonly value: string }[] = [
  { name: 'RECIPE_NOT_FOUND_MESSAGE', value: RECIPE_NOT_FOUND_MESSAGE },
  { name: 'RECIPE_UNREADABLE_MESSAGE', value: RECIPE_UNREADABLE_MESSAGE },
];

const spellsOut = (code: string, message: string): boolean =>
  new RegExp(`['"\`]${escapeRe(message)}['"\`]`).test(code);

// ─── The flows that must still be consuming the helper ────────────────────────

const CONSUMERS: readonly string[] = [
  'flows/generateGuidedPlan.ts',
  'flows/extractProcessStages.ts',
  'flows/proposeSchedule.ts',
];

const importsHelper = (code: string): boolean =>
  /import\s*\{[^}]*\brequireRecipe(?:From)?\b[^}]*\}\s*from\s*['"][^'"]*loadRecipe\.js['"]/.test(
    code,
  );

// ─────────────────────────────────────────────────────────────────────────────

describe('cloud-functions: the recipe-load prologue is written once', () => {
  it('can still see the source tree, and the helper in it', () => {
    // An anchor, not an inventory: a walk that collapsed, or lost the `.ts`
    // filter, fails here instead of green-lighting everything below.
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => f.path)).toContain(HELPER);
    // And a couple of the excluded readers, so a walk that stopped descending
    // into `triggers/` or `callables/` cannot pass either.
    expect(files.map((f) => f.path)).toContain('triggers/onCookTimerDispatch.ts');
    expect(files.map((f) => f.path)).toContain('callables/getImagePrompt.ts');
  });

  it('reads both messages off the module that owns them', () => {
    // The anti-vacuity anchor for the message half. If `loadRecipe.ts` is
    // deleted this file cannot import at all; if a constant is emptied or
    // renamed, this fails rather than the guard policing an empty string.
    for (const { name, value } of MESSAGES) {
      expect(value, `${name} is empty`).not.toBe('');
      expect(typeof value, `${name} is not a string`).toBe('string');
    }
    expect(RECIPE_NOT_FOUND_MESSAGE).not.toBe(RECIPE_UNREADABLE_MESSAGE);
    // The helper is the one file allowed to contain them, and it must.
    const helper = files.find((f) => f.path === HELPER)!;
    for (const { name, value } of MESSAGES) {
      expect(spellsOut(helper.code, value), `${HELPER} no longer declares ${name}`).toBe(true);
    }
  });

  it('recognises the prologue when it sees one', () => {
    // The real thing, as it stood in generateGuidedPlan before this issue.
    const copy = `
      const db = getFirestore();
      const snap = await db.collection('recipes').doc(recipeId).get();
      if (!snap.exists) {
        throw new HttpsError('not-found', "That recipe doesn't exist.");
      }
      const recipe = RecipeSchema.safeParse(snap.data());
      if (!recipe.success) {
        throw new HttpsError('failed-precondition', "That recipe can't be read.");
      }`;
    expect(writesPrologue(copy)).toBe(true);

    // And proposeSchedule's variant, where the fetch is one leg of a Promise.all
    // — a copy the guard would be useless if it could not see.
    const parallelCopy = `
      const [recipeSnap] = await Promise.all([db.collection('recipes').doc(id).get()]);
      if (!recipeSnap.exists) throw new HttpsError('not-found', 'gone');
      const r = RecipeSchema.safeParse(recipeSnap.data());
      if (!r.success) throw new HttpsError('failed-precondition', 'unreadable');`;
    expect(writesPrologue(parallelCopy)).toBe(true);
  });

  it('does not fire on the near-misses standing in this tree today', () => {
    // Every one of these is a real shape in `src`, and each is one pattern short.

    // onCookTimerDispatch: reads and parses, returns null rather than throwing —
    // "a bad recipe must never cost us the notification".
    expect(
      writesPrologue(`
        const snap = await getFirestore().collection('recipes').doc(recipeId).get();
        if (!snap.exists) return null;
        const parsed = RecipeSchema.safeParse(snap.data());
        return parsed.success ? parsed.data : null;`),
    ).toBe(false);

    // proposeSchedule as it stands AFTER the migration: the collection literal
    // and the callable errors are still there, the parse is not.
    expect(
      writesPrologue(`
        const [recipeSnap, formulaSnap] = await Promise.all([
          db.collection('recipes').doc(recipeId).get(),
          db.collection('formulas').doc(recipeId).get(),
        ]);
        const recipe = requireRecipeFrom(recipeSnap);
        if (!formulaSnap.exists) {
          throw new HttpsError('failed-precondition', "That recipe doesn't have a formula yet.");
        }`),
    ).toBe(false);

    // canonicaliseRecipeIngredients: a collection-wide projection, no by-id read.
    expect(
      writesPrologue(`
        const snaps = await db.collection('recipes').select('ingredients').get();
        if (snaps.empty) throw new HttpsError('not-found', 'nothing to canonicalise');
        RecipeSchema.safeParse(snaps.docs[0].data());`),
    ).toBe(false);

    // An ordinary callable that throws both codes about something else entirely.
    expect(
      writesPrologue(`
        if (!snap.exists) throw new HttpsError('not-found', 'No such formula.');
        throw new HttpsError('failed-precondition', 'That formula has no stages yet.');`),
    ).toBe(false);
  });

  it('recognises a re-spelled message, and leaves the neighbouring ones alone', () => {
    expect(spellsOut(`  throw new Error("${RECIPE_NOT_FOUND_MESSAGE}");`, RECIPE_NOT_FOUND_MESSAGE)).toBe(true); // prettier-ignore
    expect(spellsOut(`  const m = '${RECIPE_UNREADABLE_MESSAGE}';`, RECIPE_UNREADABLE_MESSAGE)).toBe(true); // prettier-ignore

    // The three sibling messages that live one line away from these in
    // proposeSchedule, none of which is the recipe's.
    for (const neighbour of [
      "That recipe doesn't have a formula yet.",
      "That formula can't be read.",
      'No such recipe.',
    ]) {
      for (const { value } of MESSAGES) {
        expect(spellsOut(`  throw new HttpsError('failed-precondition', '${neighbour}');`, value)).toBe(false); // prettier-ignore
      }
    }
  });

  it('has no file outside the helper writing the prologue out by hand', () => {
    const offenders = files
      .filter((f) => f.path !== HELPER && !allowedPaths.has(f.path) && writesPrologue(f.code))
      .map(
        (f) =>
          `${f.path}: ${PROLOGUE.map((p) => p.what).join(', ')} — ` +
          `call requireRecipe(recipeId) or requireRecipeFrom(snap) from src/${HELPER} instead. ` +
          `If this site genuinely differs (it must NOT throw, or it collapses the two codes ` +
          `deliberately), add it to ALLOWED above WITH its reason — never just to make CI pass.`,
      );
    expect(offenders).toEqual([]);
  });

  it('has no file outside the helper spelling out either message', () => {
    const offenders = files.flatMap((f) =>
      f.path === HELPER
        ? []
        : MESSAGES.filter(({ value }) => spellsOut(f.code, value)).map(
            ({ name }) =>
              `${f.path}: writes out ${name} — import it from src/${HELPER}, or better, throw ` +
              `through the helper that owns it. Two spellings of one sentence is how the ` +
              `three copies drifted in the first place.`,
          ),
    );
    expect(offenders).toEqual([]);
  });

  it('still has all three flows consuming the helper', () => {
    // The other half of anti-vacuity: the matchers above go quiet if a flow
    // re-inlines the prologue in a shape they cannot see, but a flow that stops
    // importing the helper trips this whatever its replacement looks like.
    for (const path of CONSUMERS) {
      const file = files.find((f) => f.path === path);
      expect(file, `${path} is gone — if a flow was renamed, update CONSUMERS`).toBeDefined();
      expect(
        importsHelper(file!.code),
        `${path} no longer imports requireRecipe/requireRecipeFrom from ${HELPER}`,
      ).toBe(true);
    }
  });

  it('names a reason for every allowlist entry, and none that has gone stale', () => {
    for (const { path, why } of ALLOWED) {
      expect(
        files.map((f) => f.path),
        `${path} no longer exists`,
      ).toContain(path);
      expect(why.length, `${path} has no reason`).toBeGreaterThan(20);
      // An entry excusing a file that no longer offends is an entry hiding the
      // next offence at that path.
      const file = files.find((f) => f.path === path)!;
      expect(
        writesPrologue(file.code),
        `${path} no longer writes the prologue — delete its ALLOWED entry`,
      ).toBe(true);
    }
  });
});
