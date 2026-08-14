import type { ProcessStage, StageDuration } from '../schemas/index.js';

// Placing a process on a clock (issue #812, phase 2 of epic #778).
//
// BIDIRECTIONAL FROM THE START, and the backward direction is the one that
// justifies the function. "Out of the oven at 07:30" lands on 07:30 EXACTLY BY
// CONSTRUCTION — the last stage's end IS the anchor, and every earlier boundary is
// subtracted back from it — rather than by anyone adding up six stages and hoping.
// Building the forward direction alone would bake "the start is the input" into the
// types, which is the same mistake `solveFormula` was careful not to make about
// yield.
//
// PURE, and the clock is nowhere near it (CLAUDE.md Rule 1). The anchor is passed
// in — there is no "now", no timezone and no locale here. ISO-8601 in, ISO-8601
// out, in UTC (`toISOString`), which is what the batch stores and what
// `Date.parse` reads back without ambiguity.
//
// TOTAL: no throw, no NaN, no `Invalid Date`. Anything unschedulable comes back as
// a typed failure, in the register `solveFormula` set.
//
// ─── Which number a RANGE is scheduled at: THE LONG END ─────────────────────────
//
// `StageDurationSchema` deliberately keeps "prove for 45–60 minutes" as a range,
// so a schedule that needs one number per stage has to choose. It takes the TOP.
//
//   • A schedule is a commitment to be somewhere. A prove that takes 45–60 minutes
//     is not reliably done at 45, so planning to the short end guarantees the
//     target is missed more often than it is hit — and being early with dough on
//     the bench is a nuisance, while being late with a 07:30 breakfast is a failure.
//   • The midpoint is worse than either end: 52.5 minutes appears nowhere on the
//     recipe, and inventing it here is precisely the information loss the range
//     case was added to prevent.
//   • The top of the range is a figure the recipe actually states, so the schedule
//     can be read against the method it came from.
//
// Nothing is destroyed by the choice: the frozen batch stage keeps the whole
// `duration`, so a screen still shows "45–60 min" beside a clock that says 60, and
// marking the stage done at 45 re-times the rest through this same function.
//
// ─── A stage with NO duration ───────────────────────────────────────────────────
//
// "Prove until doubled" has no length. It is scheduled at ZERO ELAPSED TIME —
// `plannedStartAt` equals `plannedEndAt` — which is the same answer
// `totalDurationMinutes` gives when it declines to add such a stage to either end
// of its range: the length is not zero and it is not infinite, it is UNKNOWN, and
// the honest thing is to let the plan run straight through it rather than invent a
// figure that would push every later stage to a wrong time with an air of
// authority.
//
// The consequence is deliberate and is the machinery working: the plan around an
// observational stage is provisional, and the moment it is marked done the batch
// re-times everything after it from the real instant. An unknown duration is
// resolved by watching the dough, which is what the stage said in the first place.

/**
 * Which end of the process is nailed down.
 *
 * The two-case discriminated union deliberately mirrors `ReferenceYieldSchema`:
 * one type, neither direction privileged, and a caller that must say which of the
 * two it means.
 *
 * `at` is an ISO-8601 instant — the same string form the batch stores.
 */
export type ScheduleAnchor =
  // "I am mixing now": the first stage begins at `at`.
  | { kind: 'startAt'; at: string }
  // "Out of the oven at 07:30": the last stage ends at `at`, and everything before
  // it is back-solved.
  | { kind: 'endAt'; at: string };

/** Where one stage lands on the clock. Both are ISO-8601 UTC instants. */
export interface StageSchedule {
  plannedStartAt: string;
  plannedEndAt: string;
}

export type ScheduleFailure =
  // The anchor is not a readable instant. A programmer error rather than a user
  // one, but it crosses as a value like every other failure in this feature.
  | { kind: 'invalidAnchor'; at: string }
  // The arithmetic left the range of a JavaScript date — a duration of a hundred
  // million years, or an anchor at the edge of time. There is no schedule to give.
  | { kind: 'unschedulable'; detail: string };

export type ResolveScheduleResult<T> =
  { ok: true; stages: (T & StageSchedule)[] } | { ok: false; reason: ScheduleFailure };

// `Date` tops out at ±8.64e15 ms from the epoch; past that `toISOString()` throws
// a RangeError, which this function does not do.
const MAX_TIME_MS = 8.64e15;
const MS_PER_MINUTE = 60_000;

// The single number this stage is scheduled at. See the header for why a range
// takes its long end, and a missing duration takes zero.
//
// The max/min pair is defensive rather than decorative: a hand-edited stage may
// have been typed "60 to 45", and `StageDurationSchema` deliberately carries no
// refine that would fail a whole document over it.
function scheduledMinutes(duration: StageDuration | null): number {
  if (duration === null) return 0;
  if (duration.kind === 'fixed') return duration.minutes;
  return Math.max(duration.minMinutes, duration.maxMinutes);
}

function isoAt(ms: number): string | null {
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_TIME_MS) return null;
  return new Date(ms).toISOString();
}

/**
 * Place an ordered process on the clock, from either end.
 *
 * Generic over `T extends ProcessStage` for the same reason the stage producers
 * are: the caller is often holding something richer than a bare stage. Re-timing a
 * running batch passes `BatchStage`s — planned times plus the actuals already
 * observed — and gets them back with the planned times replaced and everything else
 * untouched, which is what makes "this prove ran twenty minutes long" a single call
 * rather than a merge.
 *
 * An empty stage list resolves to an empty schedule, not a failure: a process with
 * nothing in it is nothing to place, and there is no clock arithmetic to get wrong.
 */
export function resolveSchedule<T extends ProcessStage>(
  stages: readonly T[],
  anchor: ScheduleAnchor,
): ResolveScheduleResult<T> {
  const anchorMs = Date.parse(anchor.at);
  if (!Number.isFinite(anchorMs))
    return { ok: false, reason: { kind: 'invalidAnchor', at: anchor.at } };

  const scheduled: (T & StageSchedule)[] = new Array(stages.length);

  if (anchor.kind === 'startAt') {
    // Forward: the first stage begins at the anchor and each one hands off to the
    // next. The end of the process falls where it falls.
    let cursorMs = anchorMs;
    for (let i = 0; i < stages.length; i += 1) {
      const stage = stages[i]!;
      const startMs = cursorMs;
      const endMs = startMs + scheduledMinutes(stage.duration) * MS_PER_MINUTE;
      const plannedStartAt = isoAt(startMs);
      const plannedEndAt = isoAt(endMs);
      if (plannedStartAt === null || plannedEndAt === null) {
        return {
          ok: false,
          reason: { kind: 'unschedulable', detail: `stage ${stage.id} ran off the clock` },
        };
      }
      scheduled[i] = { ...stage, plannedStartAt, plannedEndAt };
      cursorMs = endMs;
    }
    return { ok: true, stages: scheduled };
  }

  // Backward: the LAST stage ends at the anchor, and each earlier stage ends where
  // the next one begins. The target time is not approached, it is the starting
  // point — which is why it cannot drift by a minute however many stages precede it.
  let cursorMs = anchorMs;
  for (let i = stages.length - 1; i >= 0; i -= 1) {
    const stage = stages[i]!;
    const endMs = cursorMs;
    const startMs = endMs - scheduledMinutes(stage.duration) * MS_PER_MINUTE;
    const plannedStartAt = isoAt(startMs);
    const plannedEndAt = isoAt(endMs);
    if (plannedStartAt === null || plannedEndAt === null) {
      return {
        ok: false,
        reason: { kind: 'unschedulable', detail: `stage ${stage.id} ran off the clock` },
      };
    }
    scheduled[i] = { ...stage, plannedStartAt, plannedEndAt };
    cursorMs = startMs;
  }
  return { ok: true, stages: scheduled };
}
