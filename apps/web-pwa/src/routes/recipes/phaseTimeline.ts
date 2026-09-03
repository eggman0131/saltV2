import { phaseElapsedMinutes, type RecipePhase } from '@salt/domain';

// How a phase strip is DRAWN (issue #1122). Minutes in, widths out.
//
// Split out of `RecipePhaseTimeline.svelte` rather than living inside it because
// the only judgement on this whole component is the compression rule below, and a
// rule worth arguing about is a rule worth testing without a DOM. The component
// keeps the markup and the words; this keeps the arithmetic.
//
// PRESENTATION, NOT DOMAIN. It belongs in `apps/web-pwa` for the same reason
// `segmentPercent` does on `RecipeViewPage`: `recipePhaseTotals` answers "how long
// is this", and that answer is the same on the list, on the page and on the cook
// plan. "How wide is that block" is true of one drawing on one screen. Nothing
// here is ever stored.
//
// IT DOES FEED FIGURES THE READER SEES, and an earlier version of this comment
// denied it (#1208 bullet 4). The legend prints each block's `elapsedMinutes`,
// `handsOnMinutes` and `handsOffMinutes`, and each band's `minutes` — and all but
// the first come through `drawable` below rather than straight from the phase.
// That is only safe while `drawable` and domain's `safeMinutes` clamp identically,
// which is a claim and not a guarantee, so it is pinned by a test rather than by
// this sentence (CLAUDE.md rule 12).
//
// THE DRAWING IS NOT TO SCALE, ON PURPOSE. An overnight prove is 720 minutes
// beside a 15-minute knead: drawn honestly, the knead is two pixels and the strip
// says nothing except "there is a long wait", which the words already said. So a
// hands-off stretch is drawn at most `WAIT_CAP_MINUTES` wide and MARKED as
// shortened, which is #1122's "a marked gap rather than a kilometre of bar". The
// legend beside it always carries the true figure, so the compression costs the
// reader nothing — it is the bar that lies, and it says so.

/**
 * How wide a hands-off stretch may be drawn, in minutes of drawing weight.
 *
 * Sixty, because it is the threshold the rest of the app already switches on —
 * `formatMinutes` changes unit there, and `RecipeViewPage`'s `HANDS_OFF_MINUTES`
 * calls a timer at or above it a wait you plan the evening around. A prove and a
 * twelve-hour cure therefore draw the same width, which is correct: past an hour
 * the only thing the bar can usefully say is "you are leaving the kitchen", and
 * how long for is the legend's job.
 *
 * HANDS-ON IS NEVER CAPPED. Three hours of stirring is three hours of you, and
 * that is exactly the thing the strip exists to show — compressing it would hide
 * the fact the reader opened the page for.
 */
export const WAIT_CAP_MINUTES = 60;

/** What a band of a phase block is. The component tints the three differently. */
export type PhaseBandKind = 'hands-on' | 'wait' | 'long-wait';

export interface PhaseBand {
  readonly kind: PhaseBandKind;
  /** The uncapped figure, never the drawn width. Shown in words in the legend. */
  readonly minutes: number;
  /** Share of its own block, 0–100. */
  readonly widthPercent: number;
}

export interface PhaseBlock {
  /** The author's word for this stretch. Displayed, never branched on. */
  readonly label: string;
  readonly elapsedMinutes: number;
  readonly handsOnMinutes: number;
  readonly handsOffMinutes: number;
  /** True when this block's wait was drawn shorter than it is. */
  readonly compressed: boolean;
  /** Share of the whole strip, 0–100. */
  readonly widthPercent: number;
  /** Hands-on first, then the wait. Empty for a phase timed at zero. */
  readonly bands: readonly PhaseBand[];
}

/**
 * Turn a phase list into the blocks the strip draws.
 *
 * One block per phase, in the order the phases were written — never re-sorted,
 * because the order IS the plan.
 *
 * A phase timed at zero on both fields yields a block with no bands rather than a
 * band of zero minutes: a cook who has zeroed a phase by hand still has a phase,
 * and the strip draws it as an empty slot rather than pretending to a duration.
 * When EVERY phase is zero there is no weight to share out at all, so the blocks
 * divide the strip evenly — the alternative is a division by zero rendered as a
 * blank bar, and an evenly-split empty strip at least still shows how many phases
 * there are.
 */
export function phaseTimelineBlocks(
  phases: readonly Readonly<RecipePhase>[],
): readonly PhaseBlock[] {
  const drafts = phases.map((phase) => {
    const handsOnMinutes = drawable(phase.handsOnMinutes);
    const handsOffMinutes = drawable(phase.handsOffMinutes);
    const bands: { kind: PhaseBandKind; minutes: number; weight: number }[] = [];
    if (handsOnMinutes > 0) {
      bands.push({ kind: 'hands-on', minutes: handsOnMinutes, weight: handsOnMinutes });
    }
    if (handsOffMinutes > 0) {
      bands.push({
        kind: handsOffMinutes > WAIT_CAP_MINUTES ? 'long-wait' : 'wait',
        minutes: handsOffMinutes,
        weight: Math.min(handsOffMinutes, WAIT_CAP_MINUTES),
      });
    }
    const weight = bands.reduce((sum, band) => sum + band.weight, 0);
    return {
      label: phase.label,
      elapsedMinutes: phaseElapsedMinutes(phase),
      handsOnMinutes,
      handsOffMinutes,
      compressed: handsOffMinutes > WAIT_CAP_MINUTES,
      bands,
      weight,
    };
  });

  const total = drafts.reduce((sum, draft) => sum + draft.weight, 0);
  const evenShare = drafts.length > 0 ? 100 / drafts.length : 0;

  return drafts.map((draft) => ({
    label: draft.label,
    elapsedMinutes: draft.elapsedMinutes,
    handsOnMinutes: draft.handsOnMinutes,
    handsOffMinutes: draft.handsOffMinutes,
    compressed: draft.compressed,
    widthPercent: total > 0 ? (draft.weight / total) * 100 : evenShare,
    bands: draft.bands.map((band) => ({
      kind: band.kind,
      minutes: band.minutes,
      widthPercent: draft.weight > 0 ? (band.weight / draft.weight) * 100 : 0,
    })),
  }));
}

// The same bargain `recipePhaseTotals` makes one layer down, and made again here
// because it is not exported: a `NaN`, an `Infinity` or a negative that reached a
// stored document draws as nothing rather than poisoning every width on the strip.
// Deliberately NOT a second SUMMING rule: a block's `elapsedMinutes` and the line
// beneath the legend still come from `phaseElapsedMinutes` / `recipePhaseTotals`.
// It IS a second CLAMP, and the two have to agree or a legend row stops adding up.
// `phaseTimeline.test.ts` pins that for every value `RecipePhaseSchema` admits.
function drawable(minutes: number): number {
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}
