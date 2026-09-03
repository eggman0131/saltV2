/**
 * `ShoppingListItemSchema` REFUSES an incomplete document (issue #1114).
 *
 * The row schema used to give ten of its eleven non-additive fields a
 * `.default()` and the eleventh a `.catch()`, so `safeParse({})` succeeded and
 * handed back a complete-looking blank. That is not a cosmetic oddity: the list
 * read's contract is to SKIP an invalid document and log it
 * (docs/data-model.md), and a schema that cannot fail is a contract that cannot
 * run — a row with no name, a row nothing can tick off, a row pinned "still
 * matching" forever.
 *
 * Every row below fails on `main` and passes here. They are the pin for a
 * sentence the code would otherwise only assert: that a malformed shopping
 * document is absent and noticed rather than present and quietly inert.
 *
 * ── What this suite is NOT ─────────────────────────────────────────────────
 *
 * It is not a claim that no document ever lacked one of these fields. The
 * narrowing was licensed by `scripts/audit-shopping-list-fields.mjs`, which
 * measured 0 absences across all 62 item documents in prod, staging and dev on
 * 2026-09-03 — the documents that EXIST, which is what a required field can
 * skip. The four additive fields are a different bargain entirely and are
 * covered by `shoppingListItem.schema.test.ts` and `measureNote.test.ts`, which
 * this change must leave green and unedited.
 *
 * The companion guard on `.catch()` across every schema in this directory lives
 * in `scripts/tests/schemaCatchGuard.test.mjs`, not here: it reads source files,
 * and `packages/domain` may not touch `node:fs` even in its tests (CLAUDE.md
 * Rule 1, enforced by `no-restricted-imports`).
 */
import { describe, it, expect } from 'vitest';
import { ShoppingListItemSchema } from '@salt/domain/schemas';

/** A complete row, exactly as every writer in the app produces one. */
const COMPLETE = {
  id: 'item-1',
  rawText: 'heinz baked beans 4 tins',
  notes: '',
  sources: [{ kind: 'manual' as const }],
  canonId: null,
  matchState: 'pending' as const,
  checked: false,
  needsCheck: false,
  schemaVersion: 1 as const,
  createdAt: '2026-09-03T10:00:00.000Z',
  updatedAt: '2026-09-03T10:00:00.000Z',
};

/** The eleven fields whose `.default()`/`.catch()` #1114 removed. */
const REQUIRED = [
  'id',
  'rawText',
  'notes',
  'sources',
  'canonId',
  'matchState',
  'checked',
  'needsCheck',
  'schemaVersion',
  'createdAt',
  'updatedAt',
] as const;

describe('ShoppingListItemSchema — a complete document still reads', () => {
  it('accepts the shape every writer produces', () => {
    const result = ShoppingListItemSchema.safeParse(COMPLETE);
    expect(result.success).toBe(true);
  });

  it('leaves the four additive fields absent rather than inventing them', () => {
    const result = ShoppingListItemSchema.safeParse(COMPLETE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.traceContext).toBeUndefined();
    expect(result.data.formDemand).toBeUndefined();
    expect(result.data.originalText).toBeUndefined();
    expect(result.data.measureNote).toBeUndefined();
  });

  it.each(['pending', 'matched', 'needs_approval', 'failed'])(
    'accepts the enum member %s',
    (matchState) => {
      expect(ShoppingListItemSchema.safeParse({ ...COMPLETE, matchState }).success).toBe(true);
    },
  );
});

describe('ShoppingListItemSchema — an incomplete document is REFUSED', () => {
  it('refuses the empty object outright', () => {
    // The headline of #1114: this returned `success: true` and a blank row.
    expect(ShoppingListItemSchema.safeParse({}).success).toBe(false);
  });

  it.each(REQUIRED)('refuses a document with no %s', (missing) => {
    const doc: Record<string, unknown> = { ...COMPLETE };
    delete doc[missing];
    expect(ShoppingListItemSchema.safeParse(doc).success).toBe(false);
  });
});

describe('ShoppingListItemSchema — matchState is no longer laundered', () => {
  // These three are the `.catch()`, which swallowed every one of them and
  // handed back `'pending'`. The browser then showed a row waiting to be
  // matched while `onShoppingListItemWrite` — which reads the field off the RAW
  // document and falls back to `''` — declined to match it.
  it.each([
    ['a value outside the enum', 'reticulating'],
    ['a value of the wrong type', 42],
    ['a null', null],
  ])('refuses %s', (_name, matchState) => {
    expect(ShoppingListItemSchema.safeParse({ ...COMPLETE, matchState }).success).toBe(false);
  });

  it('is the only field that was unrejectable, and nothing catches any more', () => {
    // Belt-and-braces on the grep in the DoD: a `.catch()` re-added anywhere on
    // this schema would make some malformed document parse again, and the
    // per-field rows above only cover the ones that exist today.
    const parsed = ShoppingListItemSchema.safeParse({ ...COMPLETE, matchState: 'nonsense' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(JSON.stringify(parsed.error.issues)).toContain('matchState');
  });
});

describe('ShoppingListItemSchema — what was already refused stays refused', () => {
  it.each([
    ['a wrongly-typed rawText', { rawText: 123 }],
    ['a null rawText', { rawText: null }],
    ['a source missing its discriminated members', { sources: [{ kind: 'recipe' }] }],
    ['sources that are not an array', { sources: 'oops' }],
    ['a schemaVersion of 2', { schemaVersion: 2 }],
  ])('refuses %s', (_name, overrides) => {
    expect(ShoppingListItemSchema.safeParse({ ...COMPLETE, ...overrides }).success).toBe(false);
  });

  it.each([
    ['an array', []],
    ['a string', 'nonsense'],
  ])('refuses %s, which is not a document at all', (_name, input) => {
    expect(ShoppingListItemSchema.safeParse(input).success).toBe(false);
  });
});
