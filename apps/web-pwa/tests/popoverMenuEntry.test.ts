/**
 * Source guard: a popover menu row goes through `PopoverMenuItem` (issue #930).
 *
 * Until Phase 4 this file held the opposite assertion. `@salt/ui-components`
 * shipped `Popover`, `PopoverTrigger` and `PopoverContent` and no menu *entry*,
 * so every page wrote the row as a bare `<button>` with a hand-copied class
 * string, and Phase 1 pinned that all 28 of them were exactly four shapes — the
 * baseline that made the migration provable. Phase 4 built the component and
 * the 28 became zero, so the characterization moved to
 * `packages/ui-components/tests/PopoverMenuItem.test.ts`, where the shapes now
 * live, and this file became what stops the count climbing back.
 *
 * It is worth keeping because the drift was measured, not imagined: 26 copies
 * at the #894 review, 28 a week later. Nothing mechanical stopped it, and the
 * 29th would have been written the same way — by copying a row out of whichever
 * page was already open.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The scan surface is the whole of `src`, walked — not the four pages that
 *    happened to hold the 28. A menu written on a fifth page is covered on the
 *    day it is written (UT-E1).
 *  - It proves it can still see: the walk must find `PopoverMenuItem` in use,
 *    across more than one file, so a rename that hid every row fails loudly
 *    rather than leaving the offender list trivially empty (UT-E2).
 *  - It asserts on a class string and an element name — structure — never on a
 *    label or a comment (UT-E3).
 *  - It stays inside the package (UT-E4).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// jsdom's global `URL` resolves against the document base, so the node
// `new URL(…, import.meta.url)` idiom does not work here — resolve by path.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

/**
 * The row's padding-and-size run — the part every one of the four hand-written
 * shapes shared, and the thing a 29th copy would be copying. Matched rather
 * than the whole string because a near-copy that drifted a hover colour is the
 * same defect and must not slip through on an inexact match.
 */
const ENTRY_SIGNATURE = 'rounded-sm px-2 py-1.5 text-sm';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.svelte')) out.push(path);
  }
  return out;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Every `<button …>` opening tag whose class carries the row signature. */
function bareEntries(source: string): string[] {
  return [...source.matchAll(/<button\b[^>]*?class="([^"]*)"/g)]
    .filter((m) => collapse(m[1]!).includes(ENTRY_SIGNATURE))
    .map((m) => collapse(m[0]));
}

const FILES = walk(SRC);
const SOURCES = FILES.map((file) => ({ file, source: readFileSync(file, 'utf8') }));

describe('popover menu rows go through the primitive', () => {
  it('PopoverMenuItem is actually in use, across more than one page', () => {
    // Liveness. Without it, a rename of the component would empty the offender
    // list below and this file would report green over nothing at all.
    const users = SOURCES.filter(({ source }) => source.includes('<PopoverMenuItem'));
    expect(users.length).toBeGreaterThan(1);
  });

  it('no page writes a menu row as a bare button any more', () => {
    const offenders = SOURCES.flatMap(({ file, source }) =>
      bareEntries(source).map((tag) => `${file.slice(SRC.length + 1)}: ${tag.slice(0, 120)}`),
    );
    expect(offenders).toEqual([]);
  });

  it('every page using a row imports it from @salt/ui-components (Rule 7)', () => {
    const wrong = SOURCES.filter(
      ({ source }) =>
        source.includes('<PopoverMenuItem') &&
        !/import\s*\{[^}]*\bPopoverMenuItem\b[^}]*\}\s*from\s*'@salt\/ui-components'/s.test(source),
    ).map(({ file }) => file.slice(SRC.length + 1));
    expect(wrong).toEqual([]);
  });

  it('catches a bare row, and leaves an unrelated button alone', () => {
    // The matcher against the drift it exists for, and against the shapes it
    // must not fire on — a trigger button and a row that already migrated.
    const bare = `<button type="button" class="flex w-full items-center gap-2 ${ENTRY_SIGNATURE} hover:bg-accent">`;
    const drifted = `<button type="button" class="flex w-full items-center gap-2 ${ENTRY_SIGNATURE} hover:bg-muted">`;
    const trigger = '<button type="button" class="rounded-md p-2 hover:bg-accent">';
    const migrated = '<PopoverMenuItem icon="Pencil" onclick={edit}>Edit</PopoverMenuItem>';

    expect(bareEntries(bare)).toHaveLength(1);
    expect(bareEntries(drifted)).toHaveLength(1);
    expect(bareEntries(trigger)).toEqual([]);
    expect(bareEntries(migrated)).toEqual([]);
  });
});
