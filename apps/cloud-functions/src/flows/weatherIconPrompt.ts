import type { WeatherIconId } from '@salt/domain';
import { STYLE } from './generateCanonIcon.js';

// Weather-icon prompt builder (issue #387). Produces the per-icon text prompt
// for the OFFLINE, one-off weather-icon generator
// (scripts/generate-weather-icons.mjs). It is NOT wired into any runtime flow —
// the planner renders committed static WebP assets, never live generation.
//
// House-style reuse: the locked canon STYLE string is imported VERBATIM from
// generateCanonIcon.ts (not copied) so the weather set shares the exact same
// rendering language as the grocery canon icons — same thick rounded dark
// outline, soft pastel palette, plain off-white background, app-sticker look,
// and the same negative clauses (no caption text/lettering, no faces/eyes, no
// drop shadows/gradients). The ONE relaxation: canon's "A single centered
// subject filling most of the frame." clause is dropped for weather, because a
// weather pictogram is inherently a small composite scene (sun behind a cloud,
// cloud with rain streaks, moon with stars). Everything else in STYLE is kept.
//
// The 17 ids are the single source of truth in @salt/domain
// (weatherIcon.ts → WeatherIconId); this module imports that union so a new id
// there is a compile error here until its scene wording is added (the SCENES
// record is typed `Record<WeatherIconId, string>`).

// The canon "single centered subject" sentence, verbatim, so we can strip it
// from STYLE for weather. If the canon wording ever changes this no longer
// matches and the clause simply stays in — a safe, visible failure (the
// generator would just nudge toward a single subject), not a silent style
// drift. Kept as an exact substring of the imported STYLE, never re-authored.
const SINGLE_SUBJECT_CLAUSE = ' A single centered subject filling most of the frame.';

// STYLE with ONLY the single-subject clause removed; all other house-style and
// negative clauses are preserved exactly as imported.
const WEATHER_STYLE = STYLE.replace(SINGLE_SUBJECT_CLAUSE, '');

// Weather-specific composition steer, prepended to the relaxed STYLE. It
// re-grants the composite-scene allowance the canon clause forbade and pins the
// weather conventions (off-white sky, day = sun / night = moon) without
// touching any STYLE wording.
const WEATHER_INTRO =
  'Flat vector cartoon weather pictogram. A small simple weather scene of a few elements sitting together (for example a sun peeking from behind a cloud, or a cloud with rain streaks below it) — NOT a single object. The scene fills most of the frame, centred, on a plain solid off-white sky with no horizon, ground, scenery or border.';

// Per-icon scene description. Each line is condition-accurate and distinct:
// clear vs increasing cloud cover, the rain intensity ladder (drizzle → light
// rain → showers → heavy rain), the frozen set (sleet vs light vs heavy snow),
// fog, and thunder; day variants carry a SUN, night variants a MOON (+ stars).
// Typed against WeatherIconId so the set stays exhaustive.
const SCENES: Record<WeatherIconId, string> = {
  'clear-day':
    'A clear sunny sky: one bright cheerful yellow sun with simple straight rays radiating outward, alone, no clouds at all.',
  'clear-night':
    'A clear night sky: one calm crescent moon with a few small twinkling stars scattered around it, no clouds at all.',
  'mostly-clear-day':
    'A mostly sunny sky: a bright yellow sun as the main element with one small wispy cloud drifting to the side, the sun still clearly dominant.',
  'mostly-clear-night':
    'A mostly clear night sky: a crescent moon with a few small stars as the main elements and one small wispy cloud drifting to the side, the moon still clearly dominant.',
  'partly-cloudy-day':
    'A partly cloudy daytime sky: a yellow sun peeking out from behind one rounded fluffy cloud that covers part of it, sun and cloud sharing the scene roughly equally.',
  'partly-cloudy-night':
    'A partly cloudy night sky: a crescent moon peeking out from behind one rounded fluffy cloud that covers part of it, with one or two small stars, moon and cloud sharing the scene roughly equally.',
  overcast:
    'An overcast grey sky: one or two thick rounded grey clouds completely filling the scene, no sun and no moon, no rain.',
  fog: 'Foggy weather: a soft pale cloud with three or four simple horizontal wavy mist lines drifting beneath it, hazy and low-contrast, no sun, no rain.',
  drizzle:
    'Light drizzle: one rounded grey cloud with a sparse scattering of tiny short rain dashes falling lightly beneath it, only a few drops.',
  'rain-light':
    'Light rain: one rounded grey cloud with several evenly spaced small teardrop raindrops falling straight down beneath it, a gentle steady fall.',
  'rain-heavy':
    'Heavy rain: one dark thick rain cloud with many dense diagonal rain streaks pouring heavily and close together beneath it, a strong downpour.',
  'showers-day':
    'Daytime rain showers: a yellow sun beside or behind one rounded cloud that is dropping a small cluster of teardrop raindrops, sun-and-showers together.',
  'showers-night':
    'Night-time rain showers: a crescent moon beside or behind one rounded cloud that is dropping a small cluster of teardrop raindrops, with maybe one small star.',
  sleet:
    'Sleet / icy precipitation: one grey cloud dropping a mix of teardrop raindrops AND small white snow/ice pellets together beneath it, wet and icy.',
  'snow-light':
    'Light snow: one rounded cloud with a few simple six-point snowflakes drifting gently and sparsely beneath it.',
  'snow-heavy':
    'Heavy snow: one thick cloud with many simple six-point snowflakes falling densely and close together beneath it, a heavy snowfall.',
  thunder:
    'A thunderstorm: one dark thick storm cloud with a single bold zig-zag yellow lightning bolt striking down from it, optionally a couple of rain streaks, no sun and no moon.',
};

// Runtime list of the 17 ids, in a stable order, derived from the typed SCENES
// record so it can never drift from the prompt set. WeatherIconId is a type-only
// union with no runtime array, so the offline generator (a .mjs script) imports
// THIS to know which ids to generate. The `as WeatherIconId[]` is safe: the keys
// of a `Record<WeatherIconId, string>` are exactly the union members.
export const WEATHER_ICON_IDS = Object.keys(SCENES) as WeatherIconId[];

/**
 * Builds the per-icon text prompt for the offline weather-icon generator.
 *
 * Reuses the locked canon STYLE (minus the single-subject clause) so the
 * weather set matches the grocery canon house style exactly, then appends the
 * condition-accurate scene wording for the given id. The committed canon-icon
 * seed is supplied separately by the generator as reference-conditioning media
 * (same mechanism as `generateCanonIconFlow`); this prompt only carries text.
 */
export function buildWeatherIconPrompt(iconId: WeatherIconId): string {
  const scene = SCENES[iconId];
  return `Generate a cute cartoon weather icon. ${WEATHER_INTRO} ${scene} Copy ONLY the rendering STYLE of the reference image — its line weight, outline, colouring technique, palette and plain background. Do NOT copy the apple, and do NOT add any leaf, stem, sprig, red colouring or face that came from the reference. Draw only this weather scene and nothing else. ${WEATHER_STYLE}`;
}
