/**
 * Characterisation net for the weather-icon prompt builder (issue #387) —
 * modelled on generateCanonIcon.test.ts, whose header explains the shape: the
 * prompt is PINNED BY EXACT EQUALITY, and the literals below are a deliberate
 * second copy of locked wording, which is what makes them a CHANGE DETECTOR
 * rather than a second source of truth. Nothing but this file reads them.
 *
 * Added under #995, whose apple-negatives dedupe must leave every assembled
 * prompt byte-identical — the other three icon families carry exact-string
 * nets from #989 Phase 3; this file gives the weather family the same referee.
 * The committed WebP icons are never regenerated at runtime, so a red here
 * means WORDING drifted, not pictures: update the literal only alongside a
 * deliberate re-generation of the committed set.
 */
import { describe, expect, it, vi } from 'vitest';

// The builder under test is pure, but its module chain reaches the Genkit
// runtime: weatherIconPrompt imports STYLE from generateCanonIcon.ts, which
// defines the canon flow via defineIconFlow (→ src/genkit.ts boot, seed asset,
// model resolution). Stubbing that one factory seam keeps this a prompt test
// rather than a runtime boot — the flow it returns is never invoked here.
vi.mock('../../src/flows/defineIconFlow.js', () => ({
  defineIconFlow: () => async () => {
    throw new Error('defineIconFlow stub: not under test');
  },
}));

const { WEATHER_ICON_IDS, buildWeatherIconPrompt } =
  await import('../../src/flows/weatherIconPrompt.js');

// Source of truth for every character below: `buildWeatherIconPrompt` in
// `src/flows/weatherIconPrompt.ts`, whose closing clause is the imported canon
// `STYLE` minus the single-subject sentence. Change the wording there and
// update these literals by hand in the same commit.
const PROMPT_CLEAR_DAY =
  'Generate a cute cartoon weather icon. Flat vector cartoon weather pictogram. A small simple weather scene of a few elements sitting together (for example a sun peeking from behind a cloud, or a cloud with rain streaks below it) — NOT a single object. The scene fills most of the frame, centred, on a plain solid off-white sky with no horizon, ground, scenery or border. A clear sunny sky: one bright cheerful yellow sun with simple straight rays radiating outward, alone, no clouds at all. Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only this weather scene and nothing else. Flat vector cartoon illustration. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No caption text, no separate labels, and no lettering added under, beside, or around the subject; any text must be part of the depicted item itself (such as wording printed on a tin or jar). No drop shadows, no background gradients. Square composition, app sticker / emoji style.';

const PROMPT_THUNDER =
  'Generate a cute cartoon weather icon. Flat vector cartoon weather pictogram. A small simple weather scene of a few elements sitting together (for example a sun peeking from behind a cloud, or a cloud with rain streaks below it) — NOT a single object. The scene fills most of the frame, centred, on a plain solid off-white sky with no horizon, ground, scenery or border. A thunderstorm: one dark thick storm cloud with a single bold zig-zag yellow lightning bolt striking down from it, optionally a couple of rain streaks, no sun and no moon. Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only this weather scene and nothing else. Flat vector cartoon illustration. Thick, uniform, rounded dark outline. Soft cheerful limited pastel colour palette. Simple minimal friendly shapes, low detail. Plain solid off-white background. No border or frame around the image; the subject sits directly on the plain background. No faces, no eyes, no facial expressions on any object. No caption text, no separate labels, and no lettering added under, beside, or around the subject; any text must be part of the depicted item itself (such as wording printed on a tin or jar). No drop shadows, no background gradients. Square composition, app sticker / emoji style.';

describe('buildWeatherIconPrompt', () => {
  it('builds the locked clear-day prompt exactly', () => {
    expect(buildWeatherIconPrompt('clear-day')).toBe(PROMPT_CLEAR_DAY);
  });

  it('builds the locked thunder prompt exactly', () => {
    expect(buildWeatherIconPrompt('thunder')).toBe(PROMPT_THUNDER);
  });

  it('drops the single-subject clause for every id, keeping the rest of STYLE', () => {
    // Weather's one relaxation of the canon house style: a pictogram here is a
    // composite scene, so canon's single-subject sentence must not appear —
    // while the rest of STYLE (checked via its first and last clauses) must.
    expect(WEATHER_ICON_IDS).toHaveLength(17);
    for (const id of WEATHER_ICON_IDS) {
      const prompt = buildWeatherIconPrompt(id);
      expect(prompt).not.toContain('A single centered subject filling most of the frame.');
      expect(prompt).toContain('Flat vector cartoon illustration.');
      expect(prompt).toContain('app sticker / emoji style.');
    }
  });
});
