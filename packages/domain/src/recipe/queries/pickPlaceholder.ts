import type { WeatherDaySummary } from '../../schemas/index.js';
import { classifyEatingMood } from '../../weather/index.js';
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

// A tag matches a mood on a trimmed, case-insensitive compare. Tags are typed by
// hand into an ordinary text field, so "Comfort " is the same mood as "comfort";
// a genuine typo silently drops that document out of its set, which with ten
// hand-made documents is cheap to spot and cheap to fix (issue #652).
function hasMood(recipe: Recipe, mood: PlaceholderMood): boolean {
  return recipe.metadata.tags.some((tag) => tag.trim().toLowerCase() === mood);
}

/**
 * Picks the placeholder recipe id for a planner day, or `null` when there is
 * nothing to pick.
 *
 * @param recipes every recipe the caller holds — filtered to placeholders here.
 * @param dateKey the day being planned, `YYYY-MM-DD`.
 * @param weather that evening's forecast summary, when one exists.
 *
 * Returns `null` when the chosen mood's set is empty — including before any
 * placeholder has been built at all, which is the whole of this feature's
 * behaviour until the library exists. The day then stays a block of text.
 */
export function pickPlaceholder(
  recipes: readonly Recipe[],
  dateKey: string,
  weather?: WeatherDaySummary,
): string | null {
  const mood = moodFor(dateKey, weather);

  // Sorted by id so the choice depends only on the SET of placeholders, never on
  // the order the caller happened to hold them in.
  const candidates = recipes
    .filter((recipe) => recipe.kind === 'placeholder' && hasMood(recipe, mood))
    .map((recipe) => recipe.id)
    .sort();

  if (candidates.length === 0) return null;
  return candidates[hashDateKey(dateKey) % candidates.length] ?? null;
}
