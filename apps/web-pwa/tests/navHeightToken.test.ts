/**
 * Source guard: nothing in this app re-states the bottom-nav height (issue #930).
 *
 * Two things here sit above the fixed `BottomNav` and have to clear it — the
 * toast viewport in `App.svelte` and the recipe chat drawer — and both wrote
 * `calc(3.5rem + env(safe-area-inset-bottom))` by hand, agreeing with
 * `BottomNav`'s own `h-14` by nothing more than everyone having copied the same
 * number. Phase 5 made it `--salt-layout-bottom-nav-height`, declared in
 * `design.md` and mirrored in `salt.css`; this stops a third copy appearing here.
 *
 * The failure is quiet, and only on phones. A drifted reservation does not
 * throw, does not fail a page test, and looks fine on the desktop viewport where
 * the nav is not rendered at all — it just puts a toast, or the top of the chat
 * drawer, behind the nav bar.
 *
 * ── The boundary of the claim (CLAUDE.md Rule 12) ────────────────────────────
 *
 * `3.5rem` is banned in this app's class strings, and that is exact: nothing
 * else in web-pwa is 3.5rem.
 *
 * `h-14` is NOT banned. `RecipeViewPage` uses it for a 56px thumbnail, which is
 * a genuinely different thing that happens to share the number, and the app
 * never sets the nav's height anyway — `BottomNav` owns that, and the matching
 * guard over there is `packages/ui-components/tests/navHeightToken.test.ts`.
 * What this file can see is a RESERVATION written as a literal; a bare `h-14`
 * that someone intends as the nav height is outside it.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The scan surface is the whole of `src`, walked (UT-E1).
 *  - It proves it can still see: the token must be consumed here, in more than
 *    one file, so a rename fails loudly rather than emptying the offender list
 *    (UT-E2).
 *  - It asserts on class strings — structure, never prose (UT-E3).
 *  - It stays inside the package (UT-E4).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// jsdom's global `URL` resolves against the document base, so the node
// `new URL(…, import.meta.url)` idiom does not work here — resolve by path.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

const TOKEN = '--salt-layout-bottom-nav-height';
/** The literal the token replaced. Nothing else in this app is 3.5rem. */
const LITERAL = '3.5rem';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(svelte|ts)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Class strings only — a `3.5rem` in a comment is prose, not a second copy. */
function classStrings(source: string): string[] {
  return [
    ...[...source.matchAll(/class="([^"]*)"/g)].map((m) => m[1]!),
    ...[...source.matchAll(/'([^']*(?:pb-|bottom-|h-)\[[^']*)'/g)].map((m) => m[1]!),
  ];
}

const FILES = walk(SRC).map((file) => ({
  rel: file.slice(SRC.length + 1),
  source: readFileSync(file, 'utf8'),
}));

describe('nothing in web-pwa re-states the bottom-nav height', () => {
  it('the token is consumed here, in more than one file', () => {
    // Liveness. Without it a rename would leave the offender list below
    // trivially empty and this file green over nothing.
    const consumers = FILES.filter((f) => f.source.includes(TOKEN)).map((f) => f.rel);
    expect(consumers.length).toBeGreaterThan(1);
    expect(consumers).toEqual(
      expect.arrayContaining(['App.svelte', 'routes/recipes/RecipeChatDrawer.svelte']),
    );
  });

  it('no class string writes the height as a literal', () => {
    const offenders = FILES.flatMap(({ rel, source }) =>
      classStrings(source)
        .filter((c) => c.includes(LITERAL))
        .map((c) => `${rel}: ${c.slice(0, 100)}`),
    );
    expect(offenders).toEqual([]);
  });

  it('every nav reservation resolves the token rather than a number', () => {
    // The rule stated positively: anything combining a bottom offset with the
    // home-bar inset AND the nav height must read the token. The sheet
    // primitive's `pb-[calc(1.5rem+env(...))]` is a different measurement and is
    // deliberately not in scope — it clears the home bar, not the nav.
    const reservations = FILES.flatMap(({ rel, source }) =>
      classStrings(source)
        .filter((c) => /(?:pb|bottom)-\[calc\(/.test(c) && c.includes('safe-area-inset-bottom'))
        .map((c) => ({ rel, c })),
    );
    expect(reservations.length).toBeGreaterThan(0);
    const withoutToken = reservations.filter(({ c }) => !c.includes(TOKEN));
    expect(withoutToken.map(({ rel, c }) => `${rel}: ${c.slice(0, 100)}`)).toEqual([]);
  });

  it('catches a literal reservation, and leaves an unrelated h-14 alone', () => {
    const drifted = '<div class="bottom-[calc(3.5rem_+_env(safe-area-inset-bottom))]">';
    const thumbnail = '<div class="h-14 w-14 shrink-0 overflow-hidden rounded bg-muted">';

    expect(classStrings(drifted).some((c) => c.includes(LITERAL))).toBe(true);
    expect(classStrings(thumbnail).some((c) => c.includes(LITERAL))).toBe(false);
  });
});
