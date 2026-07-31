import { describe, it, expect } from 'vitest';
import { pickPlaceholder, PLACEHOLDER_MOODS, emptyRecipe } from '@salt/domain';
import type { PlaceholderMood, Recipe, RecipeKind } from '@salt/domain';
import type { WeatherDaySummary } from '@salt/domain/schemas';

// Which picture a note-only planner night gets (issue #652). The season leads
// because it is known for every day; a decisive forecast overrides it; the hash
// picks within the mood so a week varies and never reshuffles.

function entry(id: string, kind: RecipeKind, tags: string[] = []): Recipe {
  const base = emptyRecipe(id, '2026-01-01T00:00:00.000Z');
  return { ...base, kind, metadata: { ...base.metadata, tags } };
}

function placeholders(mood: PlaceholderMood, count: number): Recipe[] {
  return Array.from({ length: count }, (_, i) => entry(`ph-${mood}-${i}`, 'placeholder', [mood]));
}

// A summary at a given feels-like temperature, with the secondary signals sat
// squarely in the middle so only the temperature can decide anything.
function evening(apparentTemp: number): WeatherDaySummary {
  return {
    tempHigh: apparentTemp + 1,
    tempLow: apparentTemp - 1,
    apparentTemp,
    humidity: 65,
    cloudCover: 55,
    precipitationChance: 20,
  };
}

const LIBRARY = [...placeholders('bright', 5), ...placeholders('comfort', 5)];

// Which mood a returned id belongs to — the assertion every season/weather test
// actually cares about.
function moodOf(id: string | null): PlaceholderMood | null {
  if (id === null) return null;
  return id.includes('bright') ? 'bright' : 'comfort';
}

describe('pickPlaceholder — the mood constants', () => {
  it('exports exactly the two moods the library is built in', () => {
    expect([...PLACEHOLDER_MOODS]).toEqual(['bright', 'comfort']);
  });
});

describe('pickPlaceholder — season', () => {
  it('reads April through September as bright', () => {
    for (const month of ['04', '05', '06', '07', '08', '09']) {
      expect(moodOf(pickPlaceholder(LIBRARY, `2026-${month}-15`))).toBe('bright');
    }
  });

  it('reads October through March as comfort', () => {
    for (const month of ['10', '11', '12', '01', '02', '03']) {
      expect(moodOf(pickPlaceholder(LIBRARY, `2026-${month}-15`))).toBe('comfort');
    }
  });

  it('flips exactly at the boundary days, not near them', () => {
    // The four days the six/six split turns on. A boundary that drifted a month
    // would be invisible in the middle-of-the-month cases above.
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-03-31'))).toBe('comfort');
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-04-01'))).toBe('bright');
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-09-30'))).toBe('bright');
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-10-01'))).toBe('comfort');
  });
});

describe('pickPlaceholder — weather override', () => {
  it('a cold June evening overrides the season to comfort', () => {
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-06-15'))).toBe('bright');
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-06-15', evening(9)))).toBe('comfort');
  });

  it('a warm October evening overrides the season to bright', () => {
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-10-15'))).toBe('comfort');
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-10-15', evening(24)))).toBe('bright');
  });

  it('an unremarkable evening leaves the season standing, both ways', () => {
    // 17° with middling humidity, cloud and rain chance is the ambiguous band —
    // the forecast has no opinion, so the season keeps the one it had.
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-06-15', evening(17)))).toBe('bright');
    expect(moodOf(pickPlaceholder(LIBRARY, '2026-10-15', evening(17)))).toBe('comfort');
  });

  it('changes nothing when the forecast agrees with the season', () => {
    expect(pickPlaceholder(LIBRARY, '2026-06-15', evening(24))).toBe(
      pickPlaceholder(LIBRARY, '2026-06-15'),
    );
    expect(pickPlaceholder(LIBRARY, '2026-12-15', evening(4))).toBe(
      pickPlaceholder(LIBRARY, '2026-12-15'),
    );
  });
});

describe('pickPlaceholder — the empty set', () => {
  it('returns null before any placeholder has been built', () => {
    // The whole of this feature's behaviour until the library exists: the day
    // stays a block of text.
    expect(pickPlaceholder([], '2026-06-15')).toBeNull();
  });

  it('returns null when only the OTHER mood has entries', () => {
    // Deliberately does not fall back across moods — a summer evening would
    // rather stay a text block than wear a lamplit winter photograph.
    const brightOnly = placeholders('bright', 5);
    expect(pickPlaceholder(brightOnly, '2026-06-15')).not.toBeNull();
    expect(pickPlaceholder(brightOnly, '2026-12-15')).toBeNull();
  });

  it('ignores every other kind of entry, however it is tagged', () => {
    const decoys = [
      entry('r-1', 'recipe', ['bright']),
      entry('o-1', 'outing', ['bright']),
      entry('c-1', 'cocktail', ['bright']),
    ];
    expect(pickPlaceholder(decoys, '2026-06-15')).toBeNull();
  });

  it('ignores a placeholder carrying neither mood tag', () => {
    expect(pickPlaceholder([entry('ph-untagged', 'placeholder', ['summer'])], '2026-06-15')).toBe(
      null,
    );
  });

  it('matches a mood tag regardless of case and surrounding space', () => {
    const sloppy = [entry('ph-sloppy', 'placeholder', ['  Bright '])];
    expect(pickPlaceholder(sloppy, '2026-06-15')).toBe('ph-sloppy');
  });
});

describe('pickPlaceholder — determinism', () => {
  it('gives the same day the same picture every time it is asked', () => {
    const first = pickPlaceholder(LIBRARY, '2026-06-15');
    for (let i = 0; i < 20; i++) {
      expect(pickPlaceholder(LIBRARY, '2026-06-15')).toBe(first);
    }
  });

  it('does not depend on the order the caller holds the recipes in', () => {
    const shuffled = [...LIBRARY].reverse();
    expect(pickPlaceholder(shuffled, '2026-06-15')).toBe(pickPlaceholder(LIBRARY, '2026-06-15'));
  });

  it('varies across a week rather than repeating one picture', () => {
    const week = [
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
      '2026-06-19',
      '2026-06-20',
      '2026-06-21',
    ];
    const picked = week.map((day) => pickPlaceholder(LIBRARY, day));
    // Seven days over a five-image set must collide somewhere — what matters is
    // that the week reads as varied rather than as one photograph repeated.
    expect(new Set(picked).size).toBeGreaterThanOrEqual(4);
    expect(picked.every((id) => id !== null)).toBe(true);
  });

  it('is pure — does not mutate the list it is given', () => {
    const list = [...LIBRARY];
    pickPlaceholder(list, '2026-06-15');
    expect(list).toEqual(LIBRARY);
  });
});
