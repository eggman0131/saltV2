import { describe, it, expect } from 'vitest';

import {
  selectOrphanedObjects,
  idFromObjectPath,
  type SweepCandidate,
} from '../../src/maintenance/sweepOrphanedStorage.js';

const NOW = Date.UTC(2026, 6, 28);
const DAY = 86_400_000;

function candidate(id: string, ageDays: number): SweepCandidate {
  return { path: `canon-icons/${id}.webp`, id, createdAt: NOW - ageDays * DAY };
}

describe('idFromObjectPath', () => {
  it('extracts the doc id from a prefixed object path', () => {
    expect(idFromObjectPath('canon-icons/abc123.webp', 'canon-icons/')).toBe('abc123');
    expect(idFromObjectPath('recipe-images/r-1.webp', 'recipe-images/')).toBe('r-1');
  });

  it('keeps dots inside the id, splitting only on the extension', () => {
    expect(idFromObjectPath('canon-icons/a.b.c.webp', 'canon-icons/')).toBe('a.b.c');
  });

  it('handles an extensionless object', () => {
    expect(idFromObjectPath('canon-icons/abc123', 'canon-icons/')).toBe('abc123');
  });

  it('rejects anything not directly under the prefix', () => {
    expect(idFromObjectPath('other/abc.webp', 'canon-icons/')).toBeNull();
    expect(idFromObjectPath('canon-icons/nested/abc.webp', 'canon-icons/')).toBeNull();
  });

  it('rejects the bare prefix and a bare extension', () => {
    expect(idFromObjectPath('canon-icons/', 'canon-icons/')).toBeNull();
    expect(idFromObjectPath('canon-icons/.webp', 'canon-icons/')).toBeNull();
  });
});

describe('selectOrphanedObjects', () => {
  it('selects an aged object whose doc is gone', () => {
    const orphan = candidate('gone', 30);
    expect(selectOrphanedObjects({ candidates: [orphan], liveIds: new Set(), now: NOW })).toEqual([
      orphan,
    ]);
  });

  it('never selects an object whose doc still exists, however old', () => {
    expect(
      selectOrphanedObjects({
        candidates: [candidate('live', 3650)],
        liveIds: new Set(['live']),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('spares an orphan younger than the grace period', () => {
    expect(
      selectOrphanedObjects({
        candidates: [candidate('fresh', 6)],
        liveIds: new Set(),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('selects an orphan exactly at the grace boundary', () => {
    expect(
      selectOrphanedObjects({
        candidates: [candidate('sevenDays', 7)],
        liveIds: new Set(),
        now: NOW,
      }),
    ).toHaveLength(1);
  });

  it('spares an orphan with a future timestamp rather than treating it as ancient', () => {
    expect(
      selectOrphanedObjects({
        candidates: [candidate('skewed', -5)],
        liveIds: new Set(),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('caps deletions per run', () => {
    const many = Array.from({ length: 20 }, (_, i) => candidate(`orphan-${i}`, 30));
    expect(
      selectOrphanedObjects({ candidates: many, liveIds: new Set(), now: NOW, limit: 5 }),
    ).toHaveLength(5);
  });

  it('separates live, fresh and doomed in one mixed pass', () => {
    const doomed = candidate('doomed', 30);
    const result = selectOrphanedObjects({
      candidates: [candidate('live', 30), candidate('fresh', 1), doomed],
      liveIds: new Set(['live']),
      now: NOW,
    });
    expect(result).toEqual([doomed]);
  });

  it('is a no-op on an empty bucket', () => {
    expect(selectOrphanedObjects({ candidates: [], liveIds: new Set(['a']), now: NOW })).toEqual(
      [],
    );
  });
});
