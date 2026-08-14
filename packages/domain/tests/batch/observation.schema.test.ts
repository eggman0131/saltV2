import { describe, it, expect } from 'vitest';
import { BatchObservationSchema } from '../../src/schemas/index.js';

// The observation log's shape (issue #812, phase 4). What is worth pinning is the
// set of entries a real log actually contains — a weight on Tuesday, a sentence on
// Thursday, a photo on Sunday — and the two bounds that catch a typo rather than a
// measurement.
//
// There is no producer to test: an observation is a document in a subcollection, so
// "append this entry" is `[...log, entry]` and appending to an array is not a
// decision (docs/domain-implementation.md). The one decision — the log's ORDER — is
// made where the log is read, by `subscribeBatchObservations`' `orderBy('at')`.

function observation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'obs-3c19',
    schemaVersion: 1,
    at: '2026-08-14T08:10:00.000Z',
    weightGrams: 1240,
    ph: null,
    temperatureC: 12,
    note: 'Bloom even, smells sweet.',
    image: null,
    ...overrides,
  };
}

describe('BatchObservationSchema', () => {
  it('accepts a full reading', () => {
    expect(BatchObservationSchema.safeParse(observation()).success).toBe(true);
  });

  // The common case, and the reason every measurement is independently nullable: a
  // real entry is usually one of the five.
  it('accepts a note with no measurements at all', () => {
    const result = BatchObservationSchema.safeParse(
      observation({ weightGrams: null, ph: null, temperatureC: null, note: 'Cased today.' }),
    );
    expect(result.success).toBe(true);
  });

  // A photo or a note is usually the point; an entry carrying neither is still a
  // valid record of "I looked at it on Sunday and it was fine". Nothing here judges.
  it('accepts an entirely empty entry', () => {
    const result = BatchObservationSchema.safeParse(
      observation({ weightGrams: null, ph: null, temperatureC: null, note: '' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts an attached photo', () => {
    const result = BatchObservationSchema.safeParse(
      observation({
        image: {
          url: 'https://firebasestorage.example/o/batch-images%2Fb1%2Fobs-3c19.webp',
          source: 'upload',
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  // Below freezing is a real place a batch sits — a garage in January, a freezer —
  // so the temperature is deliberately unbounded downwards.
  it('accepts a sub-zero temperature', () => {
    expect(BatchObservationSchema.safeParse(observation({ temperatureC: -4 })).success).toBe(true);
  });

  // A strip or a probe cannot read outside 0–14, so a value beyond it is a typo.
  it('rejects a pH outside the scale that exists', () => {
    expect(BatchObservationSchema.safeParse(observation({ ph: 15 })).success).toBe(false);
    expect(BatchObservationSchema.safeParse(observation({ ph: -1 })).success).toBe(false);
    expect(BatchObservationSchema.safeParse(observation({ ph: 4.2 })).success).toBe(true);
  });

  it('rejects a negative weight', () => {
    expect(BatchObservationSchema.safeParse(observation({ weightGrams: -1 })).success).toBe(false);
  });

  // Nothing generates an observation photo — a person took it — so the only source
  // is an upload, and the literal is what says so.
  it('rejects an image claiming a source nothing writes', () => {
    const result = BatchObservationSchema.safeParse(
      observation({ image: { url: 'https://example/x.webp', source: 'ai' } }),
    );
    expect(result.success).toBe(false);
  });

  // A missing `at` would leave the entry unorderable, which is the one thing the log
  // cannot survive: `subscribeBatchObservations` orders on it, and a Firestore
  // `orderBy` drops documents that lack the field entirely.
  it('requires the instant it was observed', () => {
    const { at: _at, ...withoutAt } = observation();
    expect(BatchObservationSchema.safeParse(withoutAt).success).toBe(false);
  });
});
