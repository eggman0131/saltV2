/**
 * Characterization: the shapes a popover menu entry takes today (issue #930,
 * Phase 1).
 *
 * `@salt/ui-components` ships `Popover`, `PopoverTrigger` and `PopoverContent`
 * but no menu *entry*, so every page writes the entry as a bare `<button>` with
 * a hand-copied class string. #930's re-read counted 28 of them across four
 * pages, up from 26 a week earlier — the drift is live, and Phase 4 replaces
 * the lot with one primitive.
 *
 * This is the baseline that makes Phase 4 provable. It pins the fact the
 * migration depends on: **every one of those buttons is one of exactly four
 * shapes** — plain, disabled, destructive, selected. If a fifth shape exists,
 * a like-for-like swap is not available and Phase 4's scope is wrong; this
 * test is where that would surface, before any code moved.
 *
 * ── How it avoids going vacuously green (docs/unit-test-spec.md §E) ──────────
 *
 *  - The scan surface is the whole of `src`, walked — not the four pages the
 *    issue named. A fifth page that copies the string is covered on the day it
 *    is written, and the count is read out of the tree rather than asserted
 *    against a number someone has to remember to raise (UT-E1, UT-E2).
 *  - It asserts on the class string — structure — never on a label, an icon
 *    name or a comment (UT-E3).
 *  - It proves it can still see: the walk must find entries, in more than one
 *    file, and the classifier is exercised against a synthetic fifth shape it
 *    must reject (UT-E2).
 *  - The path stays inside the package (UT-E4).
 *
 * After Phase 4 there are no bare entries left to find, so the shape table
 * moves to the new primitive's own variants test and this file goes with the
 * last call site. Until then it is the only thing holding the four shapes.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// jsdom's global `URL` resolves against the document base, so the node
// `new URL(…, import.meta.url)` idiom does not work here — resolve by path.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

/**
 * What makes a `class` attribute a popover menu entry rather than any other
 * button: the entry's own padding-and-size run. Chosen because it is the part
 * every one of the four shapes shares and nothing else in the app writes.
 */
const ENTRY_SIGNATURE = 'rounded-sm px-2 py-1.5 text-sm';

/** The four shapes, as they resolve with every `{…}` interpolation removed. */
const SHAPES = {
  plain: 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
  disabled:
    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50',
  destructive:
    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10',
  // The selected arm is the only one that omits `gap-2`, and the only one whose
  // class is part expression — see `selectedArmBranches` below.
  selected: 'flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
} as const;

type ShapeName = keyof typeof SHAPES;

interface Entry {
  readonly file: string;
  /** The raw `class` attribute value, interpolations and all. */
  readonly raw: string;
  /** `raw` with `{…}` removed and whitespace collapsed. */
  readonly literal: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.svelte')) out.push(path);
  }
  return out;
}

/**
 * Pull every `class="…"` whose value carries the entry signature. Svelte class
 * attributes may span lines and may contain `{…}` expressions; the expressions
 * never contain a `"`, so a double-quote delimited match is safe here.
 */
function entriesIn(file: string, source: string): Entry[] {
  const found: Entry[] = [];
  for (const match of source.matchAll(/class="([^"]*)"/g)) {
    const raw = match[1]!;
    if (!collapse(raw).includes(ENTRY_SIGNATURE)) continue;
    found.push({ file, raw, literal: stripExpressions(raw) });
  }
  return found;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
const stripExpressions = (s: string): string => collapse(s.replace(/\{[^}]*\}/g, ' '));

function classify(entry: Entry): ShapeName | null {
  for (const [name, classes] of Object.entries(SHAPES) as [ShapeName, string][]) {
    if (entry.literal === classes) return name;
  }
  return null;
}

const FILES = walk(SRC);
const ENTRIES = FILES.flatMap((file) => entriesIn(file, readFileSync(file, 'utf8')));

describe('popover menu entries — the four shapes written by hand today', () => {
  it('the walk still finds them, across more than one page', () => {
    // Liveness, not a ceiling: a rename or a move that hid every entry would
    // otherwise leave the shape assertion below trivially satisfied.
    expect(ENTRIES.length).toBeGreaterThan(20);
    expect(new Set(ENTRIES.map((e) => e.file)).size).toBeGreaterThan(1);
  });

  it('every entry in the tree is one of exactly the four known shapes', () => {
    const unknown = ENTRIES.filter((e) => classify(e) === null).map(
      (e) => `${e.file.slice(SRC.length + 1)}: ${e.literal}`,
    );
    expect(unknown).toEqual([]);
  });

  it.each(Object.keys(SHAPES) as ShapeName[])('shape %s is actually in use', (shape) => {
    // A shape nothing uses is one Phase 4's component would build for nobody.
    expect(ENTRIES.some((e) => classify(e) === shape)).toBe(true);
  });

  it('rejects a fifth shape — the classifier is not matching everything', () => {
    const impostor: Entry = {
      file: 'synthetic.svelte',
      raw: `flex w-full items-center gap-2 ${ENTRY_SIGNATURE} hover:bg-muted`,
      literal: `flex w-full items-center gap-2 ${ENTRY_SIGNATURE} hover:bg-muted`,
    };
    expect(classify(impostor)).toBeNull();
  });

  it('only the selected arm carries a conditional, and it toggles weight alone', () => {
    const conditional = ENTRIES.filter((e) => e.raw.includes('{'));
    expect(conditional).toHaveLength(1);
    expect(classify(conditional[0]!)).toBe('selected');
    // The expression's only two outcomes. Phase 4 turns this into a `selected`
    // variant; nothing else about the entry may move with it.
    const expression = conditional[0]!.raw.match(/\{[\s\S]*\}/)![0];
    expect(collapse(expression)).toContain("'font-medium'");
    expect(collapse(expression)).toContain("''");
  });

  it('the disabled shape is the plain shape plus one token, and nothing else', () => {
    // Phase 4's `disabled` variant is additive or it is not like-for-like.
    expect(SHAPES.disabled).toBe(`${SHAPES.plain} disabled:opacity-50`);
  });

  it('the selected shape is the only one that drops the icon gap', () => {
    const dropsGap = (Object.keys(SHAPES) as ShapeName[]).filter(
      (name) => !SHAPES[name].includes('gap-2'),
    );
    expect(dropsGap).toEqual(['selected']);
  });
});
