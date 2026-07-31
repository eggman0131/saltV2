import type { WeatherDaySummary } from '../../schemas/index.js';
import { classifyEatingMood, temperatureBand } from '../../weather/index.js';
import type { TemperatureBand } from '../../weather/index.js';
import type { Recipe } from '../entities/Recipe.js';

// Which placeholder photograph a note-only planner night gets (issue #652).
//
// Pure and total (CLAUDE.md Rule 1): no clock, no I/O, no storage. The day is
// supplied as a `YYYY-MM-DD` key and the evening's forecast, when there is one,
// is supplied alongside it — the caller reads both at the moment the day is
// planned and freezes the answer.
//
// The kind branch lives HERE, inside packages/domain, which is the only place
// CLAUDE.md's recipe-kind rule allows one. The caller hands over every recipe it
// has and gets back an id; it never inspects a `kind` itself.

// The two moods a placeholder can be tagged with. They are ORDINARY entries in
// the recipe's free-form `tags` array, not a schema field — ten documents did not
// justify a column that is null on every other row, nor the kind-gated form
// control a typed field would have needed in the editor (issue #652, Open
// Questions). Exported so the library and this picker cannot drift apart.
export const PLACEHOLDER_MOODS = ['bright', 'comfort'] as const;

export type PlaceholderMood = (typeof PLACEHOLDER_MOODS)[number];

// The optional condition tags. Unlike a mood — which every placeholder must carry
// to be pickable at all — these never gate anything: they are points a picture
// scores against the evening, so tagging one only ever improves its odds and
// tagging none leaves it a perfectly ordinary candidate.
//
// They describe what the mood cannot. Warm/cool is already the mood, so what is
// left to say about an evening is its SKY (wet, glaring, grey) and, more finely
// than the mood puts it, its extremes (properly hot, properly cold). Every one is
// driven by a field that is non-optional on the summary, so unlike `weatherCode`
// there is no absent-field case to handle anywhere.
//
// Exported so the library and this picker cannot drift apart — these are the
// exact strings to type into a placeholder's tag field.
export const PLACEHOLDER_CONDITION_TAGS = ['wet', 'sunny', 'cloudy', 'hot', 'cold'] as const;

export type PlaceholderCondition = (typeof PLACEHOLDER_CONDITION_TAGS)[number];

// What an untagged picture is worth. Every candidate starts here and gains one
// per condition it matches, so a picture that says nothing about the weather is
// never excluded — merely outweighed. This is the number that guarantees no
// evening can ever starve, however the library happens to be tagged.
const BASE_WEIGHT = 1;

// Months (1-12) whose evenings read BRIGHT: April through September. Six and six
// rather than four seasons — see issue #652: two moods of five images each vary
// over a fortnight where four sets of two or three would visibly repeat.
const BRIGHT_MONTHS: ReadonlySet<number> = new Set([4, 5, 6, 7, 8, 9]);

// The season is known for EVERY day, past or future, which is why it leads: the
// forecast reaches ~14 days and expires as a day ages. A key we cannot read a
// month out of falls to `comfort`; the function stays total either way.
function seasonMood(dateKey: string): PlaceholderMood {
  const month = Number(dateKey.slice(5, 7));
  return BRIGHT_MONTHS.has(month) ? 'bright' : 'comfort';
}

// The forecast overrides the season only when the two sharply disagree — a 9°
// June evening, a 19° October one. `classifyEatingMood` already draws exactly
// that line and is already tested: its temperature poles commit on their own and
// its middle band returns `neutral` unless the damp/grey/wet vs dry/clear signals
// break the tie. So a decisive reading wins and `neutral` leaves the season
// standing; where the two agree the override changes nothing by construction.
function moodFor(dateKey: string, weather?: WeatherDaySummary): PlaceholderMood {
  const season = seasonMood(dateKey);
  if (!weather) return season;

  switch (classifyEatingMood(weather)) {
    case 'hot-comfort':
      return 'comfort';
    case 'cold-fresh':
      return 'bright';
    default:
      return season;
  }
}

// FNV-1a over the date key. Any stable string hash would do; what matters is that
// it is deterministic — the same day always picks the same picture, so a week
// does not reshuffle under you — and that consecutive days scatter rather than
// walk in step. Over a five-image set FNV-1a lands adjacent days on the same
// picture ~6% of the time against the ~20% a uniform hash would give, so a week
// reads as varied without any anti-repeat machinery.
function hashDateKey(dateKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// A tag matches on a trimmed, case-insensitive compare. Tags are typed by hand
// into an ordinary text field, so "Comfort " is the same mood as "comfort"; a
// genuine typo silently drops that document out of its set, which with a
// hand-made library is cheap to spot and cheap to fix (issue #652).
function hasTag(recipe: Recipe, tag: string): boolean {
  return recipe.metadata.tags.some((t) => t.trim().toLowerCase() === tag);
}

// Every cutoff below is deliberately one that already exists elsewhere in the
// weather module, so a refinement can never disagree with the planner about
// whether it is raining, grey or cold. `wet`/`sunny`/`cloudy` reuse
// `classifyEatingMood`'s own rain/clear/cloudy signals; `hot`/`cold` defer to
// `temperatureBand`, which owns all heat-band policy (issue #382).
const WET_PRECIPITATION_CHANCE = 40;
const SUNNY_CLOUD_COVER = 40; // at/below → clear sky
const CLOUDY_CLOUD_COVER = 70; // at/above → grey sky

// The heat bands that read as hot and cold in a photograph. The gap between them
// — `cool` and `mild`, roughly 8–19°C — is deliberately neither: an ordinary
// English evening should not be claiming to be either extreme.
const HOT_BANDS: ReadonlySet<TemperatureBand> = new Set(['warm', 'hot']);
const COLD_BANDS: ReadonlySet<TemperatureBand> = new Set(['freezing', 'cold']);

// What the evening actually is, as a set of tags to match pictures against. No
// priority and no exclusivity between groups: a cold wet grey evening asks for all
// three at once, and a picture carrying more of them ranks higher than one
// carrying fewer. Empty when there is no forecast, which simply means every
// picture in the mood scores zero and the ranking falls back to chance.
//
// Within a group the tags are mutually exclusive, with deliberate dead zones —
// 40–70% cloud is neither sunny nor cloudy, 8–19°C is neither hot nor cold — so an
// unremarkable evening does not claim to be something it is not.
function conditionsFor(weather?: WeatherDaySummary): readonly string[] {
  if (!weather) return [];

  const tags: string[] = [];
  if (weather.precipitationChance >= WET_PRECIPITATION_CHANCE) tags.push('wet');
  if (weather.cloudCover <= SUNNY_CLOUD_COVER) tags.push('sunny');
  else if (weather.cloudCover >= CLOUDY_CLOUD_COVER) tags.push('cloudy');

  // The planner tints by the window HIGH, so the heat tag reads the same number
  // the colour cue does rather than inventing its own view of the evening.
  const band = temperatureBand(weather.tempHigh);
  if (HOT_BANDS.has(band)) tags.push('hot');
  else if (COLD_BANDS.has(band)) tags.push('cold');

  return tags;
}

// A placeholder with no hero is not a placeholder — it is a card with no
// photograph, which is worse than the line of text it replaced. This is a real
// state, not a defensive one: `image` is required-but-nullable, so a document
// whose generation failed parses perfectly well and reads back as `image: null`.
// (A document missing the field entirely fails validation and never reaches the
// app at all, so this guard is precisely for the failed-generation case.)
function hasHero(recipe: Recipe): boolean {
  return recipe.image !== null;
}

/**
 * Picks the placeholder recipe id for a planner day, or `null` when there is
 * nothing to pick.
 *
 * @param recipes every recipe the caller holds — filtered to placeholders here.
 * @param dateKey the day being planned, `YYYY-MM-DD`.
 * @param weather that evening's forecast summary, when one exists.
 *
 * The mood is the one HARD filter, so a February night can never wear a summer
 * table. The weather does NOT filter — it WEIGHTS: a picture is worth one, plus
 * one for every condition tag it shares with the evening, and the day draws from
 * that distribution. So a closer match is proportionally likelier, an untagged
 * picture keeps a real chance, every picture stays eligible on every day, and no
 * combination of weather can starve a day of candidates.
 *
 * The gradient is the point. Tag one picture `sunny` and it is a little likelier
 * on a sunny evening; make five more and that kind fills most sunny evenings —
 * with no threshold to cross and nothing to switch on.
 *
 * Returns `null` only when the mood's set is empty — including before any
 * placeholder has been built at all, which is the whole of this feature's
 * behaviour until the library exists. The day then stays a block of text.
 */
export function pickPlaceholder(
  recipes: readonly Recipe[],
  dateKey: string,
  weather?: WeatherDaySummary,
): string | null {
  const mood = moodFor(dateKey, weather);
  const conditions = conditionsFor(weather);

  // Sorted by id so the draw depends only on the SET of placeholders, never on
  // the order the caller happened to hold them in.
  const weighted = recipes
    .filter((recipe) => recipe.kind === 'placeholder' && hasHero(recipe) && hasTag(recipe, mood))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((recipe) => ({
      id: recipe.id,
      weight: BASE_WEIGHT + conditions.filter((tag) => hasTag(recipe, tag)).length,
    }));

  if (weighted.length === 0) return null;

  // Walk the cumulative weights with the day's hash. With no forecast every weight
  // is BASE_WEIGHT and this is a plain uniform draw over the whole mood.
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = hashDateKey(dateKey) % total;
  for (const entry of weighted) {
    if (cursor < entry.weight) return entry.id;
    cursor -= entry.weight;
  }

  // Unreachable: the cursor is always less than the total it was taken modulo of.
  return weighted[weighted.length - 1]?.id ?? null;
}
