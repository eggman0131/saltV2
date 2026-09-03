// The verdict scripts/audit-shopping-list-fields.mjs reaches per field, and the
// one claim its header makes about itself (issue #1114, phase 1).
//
// Phase 2 removes the `.default()` from ten fields on the two shopping schemas,
// and it decides which ones off THIS script's counts. A wrong verdict here does
// not produce a wrong number on a report nobody rereads — it removes a default
// over documents that need it, and a real shopping row disappears from a real
// shopping list. So the rows below are the derivation, hand-written as REST
// literals rather than captured from a live project: a captured fixture would
// only prove the script agrees with itself.
//
// Note `integerValue`: the REST encoding carries a whole number as a JSON
// STRING, and `schemaVersion` reading back as `'1'` rather than `1` is one of
// the rows.
//
// The second suite is the mechanical half of the header's "this script only
// reads" (CLAUDE.md → Hard rule 12). An unfalsifiable sentence in a comment is
// exactly the defect class that rule exists for, and "read-only" is the claim
// under which this was pointed at production.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIST_FIELDS,
  ITEM_FIELDS,
  MATCH_STATES,
  auditDocument,
  tally,
} from '../lib/shoppingFieldAudit.mjs';

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A complete item document, as Firestore REST actually encodes one. */
const ITEM = {
  id: { stringValue: 'item-1' },
  rawText: { stringValue: 'oat milk' },
  notes: { stringValue: '' },
  sources: {
    arrayValue: { values: [{ mapValue: { fields: { kind: { stringValue: 'manual' } } } }] },
  },
  canonId: { nullValue: null },
  matchState: { stringValue: 'pending' },
  checked: { booleanValue: false },
  needsCheck: { booleanValue: false },
  schemaVersion: { integerValue: '1' },
  createdAt: { stringValue: '2026-05-14T10:00:00.000Z' },
  updatedAt: { stringValue: '2026-05-14T10:00:00.000Z' },
};

const LIST = {
  id: { stringValue: 'list-1' },
  name: { stringValue: 'Weekly Shop' },
  schemaVersion: { integerValue: '1' },
  createdAt: { stringValue: '2026-05-14T10:00:00.000Z' },
  updatedAt: { stringValue: '2026-05-14T10:00:00.000Z' },
};

describe('auditDocument — a document the un-defaulted schema would accept', () => {
  it('reports nothing absent and nothing failing for a complete item', () => {
    expect(auditDocument(ITEM, 'item-1', ITEM_FIELDS)).toEqual({ absent: [], bad: [] });
  });

  it('reports nothing absent and nothing failing for a complete list', () => {
    expect(auditDocument(LIST, 'list-1', LIST_FIELDS)).toEqual({ absent: [], bad: [] });
  });

  it.each(MATCH_STATES)('accepts the enum member %s', (state) => {
    const doc = { ...ITEM, matchState: { stringValue: state } };
    expect(auditDocument(doc, 'item-1', ITEM_FIELDS).bad).toEqual([]);
  });

  it('accepts a canonId that is a string as well as one that is null', () => {
    const doc = { ...ITEM, canonId: { stringValue: 'canon-oat-milk' } };
    expect(auditDocument(doc, 'item-1', ITEM_FIELDS).bad).toEqual([]);
  });

  it('accepts a schemaVersion the console wrote as a double', () => {
    const doc = { ...ITEM, schemaVersion: { doubleValue: 1 } };
    expect(auditDocument(doc, 'item-1', ITEM_FIELDS).bad).toEqual([]);
  });
});

describe('auditDocument — absent is kept apart from present-but-failing', () => {
  const cases = [
    {
      name: 'a field the document does not carry is ABSENT, not failing',
      doc: (() => {
        const { needsCheck: _dropped, ...rest } = ITEM;
        return rest;
      })(),
      expected: { absent: ['needsCheck'], bad: [] },
    },
    {
      name: 'a document with no fields at all reports every field absent',
      doc: undefined,
      expected: { absent: ITEM_FIELDS.map(({ name }) => name), bad: [] },
    },
    {
      name: 'a wrongly-typed field is failing, not absent',
      doc: { ...ITEM, rawText: { integerValue: '123' }, checked: { stringValue: 'yes' } },
      expected: {
        absent: [],
        bad: [
          { field: 'rawText', why: 'wrong type' },
          { field: 'checked', why: 'wrong type' },
        ],
      },
    },
    {
      name: 'a matchState outside the enum carries its own reason',
      doc: { ...ITEM, matchState: { stringValue: 'nonsense' } },
      expected: { absent: [], bad: [{ field: 'matchState', why: 'outside the enum' }] },
    },
    {
      name: 'a null matchState is a type failure, not an enum one',
      doc: { ...ITEM, matchState: { nullValue: null } },
      expected: { absent: [], bad: [{ field: 'matchState', why: 'wrong type' }] },
    },
    {
      // The stop condition. The projection change in phase 1 delivers the
      // document id in place of this field, which is only safe while the two
      // agree — so this reason is counted on its own rather than as "bad".
      name: 'an id field that is not the document id carries its own reason',
      doc: { ...ITEM, id: { stringValue: 'someone-elses-id' } },
      expected: { absent: [], bad: [{ field: 'id', why: 'differs from document id' }] },
    },
    {
      name: 'an empty id field is a mismatch too, not an absence',
      doc: { ...ITEM, id: { stringValue: '' } },
      expected: { absent: [], bad: [{ field: 'id', why: 'differs from document id' }] },
    },
    {
      name: 'sources given as a string fails on type',
      doc: { ...ITEM, sources: { stringValue: 'oops' } },
      expected: { absent: [], bad: [{ field: 'sources', why: 'wrong type' }] },
    },
    {
      name: 'a schemaVersion of 2 fails the literal',
      doc: { ...ITEM, schemaVersion: { integerValue: '2' } },
      expected: { absent: [], bad: [{ field: 'schemaVersion', why: 'wrong type' }] },
    },
  ];

  it.each(cases)('$name', ({ doc, expected }) => {
    expect(auditDocument(doc, 'item-1', ITEM_FIELDS)).toEqual(expected);
  });

  it('does not audit the additive optional fields, whose absence is the contract', () => {
    const audited = ITEM_FIELDS.map(({ name }) => name);
    for (const additive of ['traceContext', 'formDemand', 'originalText', 'measureNote']) {
      expect(audited).not.toContain(additive);
    }
    // …and their absence from a real document is not reported as a finding.
    expect(auditDocument(ITEM, 'item-1', ITEM_FIELDS).absent).toEqual([]);
  });
});

describe('tally', () => {
  it('counts documents, absences and failures per field, split by reason', () => {
    const { needsCheck: _dropped, ...noNeedsCheck } = ITEM;
    const results = [
      auditDocument(ITEM, 'item-1', ITEM_FIELDS),
      auditDocument(noNeedsCheck, 'item-1', ITEM_FIELDS),
      auditDocument({ ...ITEM, matchState: { stringValue: 'nope' } }, 'item-1', ITEM_FIELDS),
      auditDocument(undefined, 'item-1', ITEM_FIELDS),
    ];

    const { documents, counts } = tally(results, ITEM_FIELDS);

    expect(documents).toBe(4);
    // Two documents lack it: the one it was dropped from, and the empty one.
    expect(counts.get('needsCheck')).toEqual({ absent: 2, bad: 0, reasons: new Map() });
    expect(counts.get('matchState')).toEqual({
      absent: 1,
      bad: 1,
      reasons: new Map([['outside the enum', 1]]),
    });
    expect(counts.get('rawText')).toEqual({ absent: 1, bad: 0, reasons: new Map() });
  });
});

/**
 * The header of scripts/audit-shopping-list-fields.mjs says it only reads, and
 * that sentence is why it was run against production. This is what makes it
 * checkable rather than merely stated.
 *
 * Comments are stripped first, deliberately: the header has to be free to
 * DISCUSS writing without tripping its own guard, and a guard that a comment can
 * satisfy is one an author silences by rewording. Verified red rather than
 * assumed — adding a single `method: 'PATCH'` fetch to the script fails this
 * row, and so does a `writeBatch` import.
 *
 * Its honest limit: it recognises the ways THIS repo's scripts write — the
 * Firestore REST verbs and endpoints, and the SDK helpers. A script that wrote
 * by some other route would pass it. That is a real gap and a small one, since
 * the script has no Firestore dependency at all and reaches the API through one
 * four-line `fetch` helper the first assertion pins to a bare GET.
 */
describe('audit-shopping-list-fields.mjs is read-only, and mechanically so', () => {
  const source = stripComments(
    readFileSync(join(scriptsDir, 'audit-shopping-list-fields.mjs'), 'utf8'),
  );

  it('never sets an HTTP method, so every request it makes is a GET', () => {
    expect(source).not.toMatch(/\bmethod\s*:/);
  });

  it.each([
    ['PATCH', /\bPATCH\b/],
    ['POST', /\bPOST\b/],
    ['PUT', /\bPUT\b/],
    ['DELETE', /\bDELETE\b/],
    ['a commit endpoint', /:commit|:batchWrite|:runQuery\b.*\bwrite/],
    ['a Firestore SDK writer', /\b(setDoc|updateDoc|deleteDoc|writeBatch|addDoc)\b/],
  ])('names no %s', (_label, pattern) => {
    expect(source).not.toMatch(pattern);
  });

  it('reaches the network through exactly one fetch, and that fetch sets no body', () => {
    expect([...source.matchAll(/\bfetch\s*\(/g)]).toHaveLength(1);
    expect(source).not.toMatch(/\bbody\s*:/);
  });
});

/**
 * Comments out, string literals kept — the same job
 * `scripts/lib/unitTestSpec.mjs` does for the UT-G3 matcher, written here
 * rather than imported because that one is private to its own rule set and this
 * suite must not go green through a change made for a different reason.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
