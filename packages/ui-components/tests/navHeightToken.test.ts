// spec: ui-spec-v04.md §13.3, §17.2 v0.4
//
// Source guard: the bottom-nav height is written once (issue #930).
//
// It used to be written five times — `h-14` in `BottomNav`, `3.5rem` inside
// three `calc()` reservations, and an assertion in `AppShell.test.ts` pinning
// the literal — plus two comments restating the number in prose. Phase 5 made it
// `--salt-layout-bottom-nav-height`, declared in `design.md` and mirrored in
// `salt.css`, and this is what stops a sixth copy.
//
// The failure it prevents is quiet and one-directional: a reservation that
// disagrees with the nav does not throw, does not fail a page test, and does not
// look wrong on a desktop viewport where the nav is not rendered at all. It
// hides the bottom of a scrolled page under the nav bar, on phones only.
//
// ── The boundary of the claim (CLAUDE.md Rule 12) ────────────────────────────
//
// `3.5rem` is banned outright in this package's class strings: nothing else in
// the design system is 3.5rem, so every occurrence was the nav height.
//
// `h-14` is NOT banned outright, and could not honestly be. `TopBar` is also
// 56px tall and writes `h-14`, and it is a genuinely different thing that
// happens to share the number — banning the utility would flag it falsely and
// teach the next author to silence the guard. So `h-14` is banned in `BottomNav`
// alone, which is where it would mean the nav height. A 56px literal invented
// for some third component is outside what this guard can see, and saying so is
// worth more than an assertion that fires on the wrong files.
//
// ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
//
//  - The scan surface is the whole of `src`, walked (UT-E1).
//  - It proves it can still see: the token must be consumed, in more than one
//    file, so a rename that emptied the offender list fails loudly (UT-E2).
//  - It asserts on class strings and a custom-property name — structure, never
//    prose (UT-E3).
//  - It stays inside the package; `apps/web-pwa`'s own three reservations are
//    guarded by `apps/web-pwa/tests/navHeightToken.test.ts` (UT-E4).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

const TOKEN = '--salt-layout-bottom-nav-height';
/** The literal the token replaced. Nothing else in this package is 3.5rem. */
const LITERAL = '3.5rem';
/** Where `h-14` would mean the nav height rather than some other 56px thing. */
const NAV_FILE = 'layout/BottomNav/BottomNav.svelte';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(svelte|ts|css)$/.test(entry.name)) out.push(path);
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
  file,
  rel: file.slice(SRC.length + 1),
  source: readFileSync(file, 'utf8'),
}));

describe('the bottom-nav height is written once', () => {
  it('the token is declared and consumed, in more than one file', () => {
    // Liveness. Without it a rename would empty every offender list below.
    expect(FILES.find((f) => f.rel === 'salt.css')!.source).toContain(TOKEN);
    // `arrayContaining`, not an exact list: the two below are what the token
    // exists for and must always be there, but a third legitimate consumer is a
    // normal thing to add and must not be a red test (UT-E1).
    const consumers = FILES.filter((f) => f.rel !== 'salt.css' && f.source.includes(TOKEN));
    expect(consumers.length).toBeGreaterThan(1);
    expect(consumers.map((c) => c.rel)).toEqual(
      expect.arrayContaining(['layout/AppShell/AppShell.svelte', NAV_FILE]),
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

  it('BottomNav states its own height through the token, not h-14', () => {
    const nav = FILES.find((f) => f.rel === NAV_FILE)!;
    expect(classStrings(nav.source).join(' ')).not.toMatch(/\bh-14\b/);
    expect(nav.source).toContain(`h-[var(${TOKEN})]`);
  });

  it('catches a literal reservation, and leaves TopBar’s unrelated h-14 alone', () => {
    // The matchers against the drift they exist for, and against the shape they
    // must not fire on — the boundary named in this file's header.
    const drifted = '<div class="pb-[calc(3.5rem_+_env(safe-area-inset-bottom))]">';
    expect(classStrings(drifted).some((c) => c.includes(LITERAL))).toBe(true);

    const topBar = FILES.find((f) => f.rel === 'layout/TopBar/TopBar.svelte')!;
    expect(topBar.source).toContain('h-14');
    expect(classStrings(topBar.source).some((c) => c.includes(LITERAL))).toBe(false);
  });

  it('sees a height written in a quoted cva/cn argument, not only in class=""', () => {
    // AppShell's reservation is a `cn()` argument in a `<script>`-adjacent
    // expression, not a `class="…"` attribute — the shape a `class="…"`-only
    // scan would miss entirely.
    const inCn = "cn('flex-1', chrome && 'pb-[calc(3.5rem_+_env(safe-area-inset-bottom))]')";
    expect(classStrings(inCn).some((c) => c.includes(LITERAL))).toBe(true);
  });
});
