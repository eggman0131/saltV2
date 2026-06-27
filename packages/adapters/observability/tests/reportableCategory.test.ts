import { describe, it, expect } from 'vitest';
import type { DomainError } from '@salt/shared-types';
import { isReportableCategory } from '../src/shared/reportableCategory.js';

// "Report the unexpected, suppress the expected." This is the single source of
// truth for the category gate, shared by the client and /server subpaths.
describe('isReportableCategory', () => {
  // Exhaustive over the DomainError kind union (shared-types §7.2). If a new kind
  // is added, this map should be updated — but note the predicate defaults a NEW
  // kind to reportable (the `unknown` case below), so a forgotten kind surfaces
  // rather than silently disappears.
  const cases: ReadonlyArray<[DomainError['kind'], boolean]> = [
    ['StorageError', true],
    ['SyncError', true],
    ['AuthError', true], // reportable by category; the sign-out race is gated elsewhere
    ['NetworkError', false],
    ['ValidationError', false],
    ['NotFound', false],
    ['ConflictError', false],
  ];

  it.each(cases)('%s → reportable=%s', (kind, expected) => {
    expect(isReportableCategory(kind)).toBe(expected);
  });

  it('suppresses exactly the expected set, reports everything else', () => {
    const reportable = cases.filter(([, r]) => r).map(([k]) => k);
    const suppressed = cases.filter(([, r]) => !r).map(([k]) => k);
    expect(new Set(suppressed)).toEqual(
      new Set(['NetworkError', 'ValidationError', 'NotFound', 'ConflictError']),
    );
    expect(reportable).toEqual(expect.arrayContaining(['StorageError', 'SyncError', 'AuthError']));
  });

  it('defaults an unknown/uncategorised kind to reportable', () => {
    // A kind outside the current union (forced cast) models a future or
    // unexpected category — it must report, never silently drop.
    expect(isReportableCategory('SomethingBrandNew' as DomainError['kind'])).toBe(true);
  });
});
