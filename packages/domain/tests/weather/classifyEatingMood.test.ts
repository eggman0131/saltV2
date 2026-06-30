import { describe, it, expect } from 'vitest';
import { classifyEatingMood } from '@salt/domain';
import type { WeatherDaySummary } from '@salt/domain/schemas';

// Pure eat-mood classification (issue #382, Phase 3). The mood POLICY (enum,
// feels-like poles, and the damp/grey/wet vs dry/clear tie-break) lives in the
// domain so the view only maps mood → glyph/label. These tests pin both poles
// from the spec plus the neutral middle and the secondary-signal tie-break.

// A baseline summary in the ambiguous feels-like middle (between the 12°C comfort
// pole and the 22°C fresh pole) with neutral secondaries; individual tests
// override the fields under test.
function summary(overrides: Partial<WeatherDaySummary> = {}): WeatherDaySummary {
  return {
    tempHigh: 18,
    tempLow: 14,
    apparentTemp: 17,
    humidity: 65,
    cloudCover: 55,
    precipitationChance: 20,
    ...overrides,
  };
}

describe('classifyEatingMood', () => {
  it('leans hot-comfort on a cold, damp, grey, rainy evening (spec pole)', () => {
    const mood = classifyEatingMood(
      summary({ apparentTemp: 6, humidity: 88, cloudCover: 90, precipitationChance: 70 }),
    );
    expect(mood).toBe('hot-comfort');
  });

  it('leans cold-fresh on a warm, dry, clear evening (spec pole)', () => {
    const mood = classifyEatingMood(
      summary({ apparentTemp: 26, humidity: 40, cloudCover: 15, precipitationChance: 0 }),
    );
    expect(mood).toBe('cold-fresh');
  });

  it('commits to a pole on feels-like temperature alone, regardless of the sky', () => {
    // Cold but dry+clear → still hot-comfort (temperature pole wins).
    expect(
      classifyEatingMood(
        summary({ apparentTemp: 5, humidity: 30, cloudCover: 10, precipitationChance: 0 }),
      ),
    ).toBe('hot-comfort');
    // Warm but humid+grey+rainy → still cold-fresh (temperature pole wins).
    expect(
      classifyEatingMood(
        summary({ apparentTemp: 25, humidity: 95, cloudCover: 95, precipitationChance: 90 }),
      ),
    ).toBe('cold-fresh');
  });

  it('returns neutral in the middle band when no secondary signal dominates', () => {
    expect(
      classifyEatingMood(
        summary({ apparentTemp: 17, humidity: 65, cloudCover: 55, precipitationChance: 20 }),
      ),
    ).toBe('neutral');
  });

  it('lets damp/grey/wet break the tie toward comfort in the middle band', () => {
    expect(
      classifyEatingMood(
        summary({ apparentTemp: 16, humidity: 80, cloudCover: 75, precipitationChance: 50 }),
      ),
    ).toBe('hot-comfort');
  });

  it('lets dry/clear break the tie toward fresh in the middle band', () => {
    expect(
      classifyEatingMood(
        summary({ apparentTemp: 18, humidity: 50, cloudCover: 35, precipitationChance: 10 }),
      ),
    ).toBe('cold-fresh');
  });

  it('treats the feels-like pole boundaries as inclusive', () => {
    expect(classifyEatingMood(summary({ apparentTemp: 12 }))).toBe('hot-comfort');
    expect(classifyEatingMood(summary({ apparentTemp: 22 }))).toBe('cold-fresh');
  });
});
