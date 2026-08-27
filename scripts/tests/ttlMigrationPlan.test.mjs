// The decisions scripts/migrate-ttl-timestamps.mjs makes about production
// documents (issues #1008, #1021).
//
// EVERY ROW BELOW IS A DECISION, NOT A DESCRIPTION. The migration has already
// run against dev and staging; these rows pin what it did there. If a row goes
// red after a change to `scripts/lib/ttlMigrationPlan.mjs`, that is the finding
// — the plan changed what it does to real data. Report it. Do not relax the row
// to match the new behaviour.
//
// `--dry-run` is mandatory before an `--apply`, but it proves the plan's OUTPUT,
// not the plan's CORRECTNESS: an operator reading 76 lines of
// `chat-x → 2026-03-01T00:00:00.000Z` has no way to see a wrong derivation. That
// is what these rows are for. They need no credentials, no `SALT_*_PROJECT` and
// no network — the plans are pure `(REST document) → { write } | { skip }`.
//
// Documents are hand-written REST literals, not fixtures captured from a live
// project. A captured fixture would only prove the script agrees with itself.
// Note `integerValue`: the REST encoding carries a whole number as a JSON
// STRING, and the coercion of it is one of the rows.

import { describe, it, expect } from 'vitest';

import { COLLECTIONS, TIMER_DELIVERY_RETENTION_MS } from '../lib/ttlMigrationPlan.mjs';

// The pre-#939 sentinel: 31 chat documents carry this instead of a real expiry.
// It converts VERBATIM — it is inside Firestore's Timestamp range and stays
// effectively unexpiring, exactly as #939 designed.
const SENTINEL = '9999-12-31T23:59:59.999Z';

// A delivery instant deliberately far in the past, so a derivation taken from
// run day instead of from the document could not produce the expected value on
// any day this suite is ever run. See the guard test below the table.
const DELIVERED_ISO = '2026-07-24T10:00:00.000Z';
const DELIVERED_MS = 1784887200000;
const DELIVERED_EXPIRES_ISO = '2026-08-07T10:00:00.000Z';

describe('COLLECTIONS.chatSessions.plan', () => {
  const cases = [
    {
      name: 'the 540-day sentinel is echoed verbatim, never re-serialised',
      doc: { id: 'chat-sentinel', fields: { expiresAt: { stringValue: SENTINEL } } },
      expected: { write: { expiresAt: { timestampValue: SENTINEL } }, detail: SENTINEL },
    },
    {
      name: 'an ordinary past-expiry ISO string becomes the same instant',
      doc: {
        id: 'chat-ordinary',
        fields: { expiresAt: { stringValue: '2026-03-01T00:00:00.000Z' } },
      },
      expected: {
        write: { expiresAt: { timestampValue: '2026-03-01T00:00:00.000Z' } },
        detail: '2026-03-01T00:00:00.000Z',
      },
    },
    {
      name: 'a document already carrying a timestampValue is skipped — a re-run writes nothing',
      doc: {
        id: 'chat-converted',
        fields: { expiresAt: { timestampValue: '2026-03-01T00:00:00Z' } },
      },
      expected: { skip: null },
    },
    {
      name: 'expiresAt absent → left alone by name',
      doc: { id: 'chat-no-field', fields: {} },
      expected: { skip: 'has no expiresAt field at all' },
    },
    {
      name: 'expiresAt holding a non-string → left alone, naming the type found',
      doc: { id: 'chat-integer', fields: { expiresAt: { integerValue: '1784887200000' } } },
      expected: { skip: 'expiresAt holds integerValue, not a string' },
    },
    {
      name: 'expiresAt holding an unparseable string → left alone, quoting it',
      doc: { id: 'chat-garbage', fields: { expiresAt: { stringValue: 'not-a-date' } } },
      expected: { skip: 'expiresAt "not-a-date" does not parse as a date' },
    },
  ];

  it.each(cases)('$name', ({ doc, expected }) => {
    expect(COLLECTIONS.chatSessions.plan(doc)).toEqual(expected);
  });
});

describe('COLLECTIONS.timerDeliveries.plan', () => {
  const cases = [
    {
      name: "expiresAt is derived from the document's own deliveredAt, not from run day",
      doc: { id: 'del-epoch', fields: { deliveredAt: { integerValue: String(DELIVERED_MS) } } },
      expected: {
        write: {
          deliveredAt: { timestampValue: DELIVERED_ISO },
          expiresAt: { timestampValue: DELIVERED_EXPIRES_ISO },
        },
        detail: `delivered ${DELIVERED_ISO} → expires ${DELIVERED_EXPIRES_ISO}`,
      },
    },
    {
      name: 'deliveredAt arriving as an integerValue — a JSON string — is coerced to a number',
      doc: { id: 'del-string-encoded', fields: { deliveredAt: { integerValue: '1736929800000' } } },
      expected: {
        write: {
          deliveredAt: { timestampValue: '2025-01-15T08:30:00.000Z' },
          expiresAt: { timestampValue: '2025-01-29T08:30:00.000Z' },
        },
        detail: 'delivered 2025-01-15T08:30:00.000Z → expires 2025-01-29T08:30:00.000Z',
      },
    },
    {
      name: 'a converted deliveredAt with no expiresAt still converts — deliveredAt alone is not enough',
      doc: { id: 'del-half-done', fields: { deliveredAt: { timestampValue: DELIVERED_ISO } } },
      expected: {
        write: {
          deliveredAt: { timestampValue: DELIVERED_ISO },
          expiresAt: { timestampValue: DELIVERED_EXPIRES_ISO },
        },
        detail: `delivered ${DELIVERED_ISO} → expires ${DELIVERED_EXPIRES_ISO}`,
      },
    },
    {
      name: 'both fields already timestampValue → skipped',
      doc: {
        id: 'del-converted',
        fields: {
          deliveredAt: { timestampValue: DELIVERED_ISO },
          expiresAt: { timestampValue: DELIVERED_EXPIRES_ISO },
        },
      },
      expected: { skip: null },
    },
    {
      name: 'deliveredAt absent → left alone by name',
      doc: { id: 'del-no-field', fields: {} },
      expected: { skip: 'has no deliveredAt field at all' },
    },
    {
      name: 'deliveredAt holding neither encoding → left alone, naming the type found',
      doc: { id: 'del-string', fields: { deliveredAt: { stringValue: DELIVERED_ISO } } },
      expected: { skip: 'deliveredAt holds stringValue' },
    },
    {
      name: 'deliveredAt holding an unparseable timestamp → left alone',
      doc: { id: 'del-garbage', fields: { deliveredAt: { timestampValue: 'not-a-date' } } },
      expected: { skip: 'deliveredAt does not parse as an instant' },
    },
  ];

  it.each(cases)('$name', ({ doc, expected }) => {
    expect(COLLECTIONS.timerDeliveries.plan(doc)).toEqual(expected);
  });

  // The rows above pin the derivation to fixed literals, which a run-day
  // derivation could not produce — but only for as long as someone reads them as
  // literals. This states the property directly: the expiry the migration grants
  // an old ledger document is in the PAST, so running the migration late does not
  // hand every old document a fresh fortnight.
  it('grants an old document an expiry that has already passed, not a fresh window', () => {
    const outcome = COLLECTIONS.timerDeliveries.plan({
      id: 'del-old',
      fields: { deliveredAt: { integerValue: String(DELIVERED_MS) } },
    });
    const expiresMs = Date.parse(outcome.write.expiresAt.timestampValue);
    expect(expiresMs).toBe(DELIVERED_MS + TIMER_DELIVERY_RETENTION_MS);
    expect(expiresMs).toBeLessThan(Date.now());
  });
});

describe('the collection table itself', () => {
  // The `--collection is required (…)` usage message is built from these keys in
  // this order, and the masked read and masked PATCH are built from `fields`.
  it('names both collections in the order the CLI usage message prints them', () => {
    expect(Object.keys(COLLECTIONS)).toEqual(['chatSessions', 'timerDeliveries']);
  });

  it('masks each read and write to only the TTL fields it converts', () => {
    expect(COLLECTIONS.chatSessions.fields).toEqual(['expiresAt']);
    expect(COLLECTIONS.timerDeliveries.fields).toEqual(['deliveredAt', 'expiresAt']);
  });
});
