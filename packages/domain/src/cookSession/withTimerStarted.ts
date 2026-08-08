import type { CookActiveTimerDoc, CookSessionDoc } from '../schemas/index.js';
import { isCheckInOf } from './checkInTimerId.js';

// Start (or restart, or re-time) a countdown. The WHOLE entry is supplied by the
// caller — `endsAt` is an ABSOLUTE ISO end-time and `id` is minted outside, never
// computed from a clock or a random source here (CLAUDE.md Rule 1). The absolute
// end-time is what lets a reload or a device switch reconstruct the remaining time
// with no extra client state.
//
// Takes the entry rather than a widening list of positional arguments: a timer now
// carries an id, a nullable step, a label and the duration it was actually started
// for, and six positional parameters would be unreadable at every call site.
//
// ONE live timer per id: any existing entry with the same `id` is replaced, and
// the new entry is appended so the timers bar orders by most-recently-started.
// Since a step timer's id IS its step id, that still means one timer per step.
//
// ─── CHECK-INS (issue #751, Phase 3) ─────────────────────────────────────────
//
// `checkIns` are the guided plan's partway reminders for this timer, already
// turned into ordinary entries by the caller (which owns the clock, and the plan —
// a different document from the session). They are appended behind the main timer
// and travel in the same whole-document write, so the enqueue trigger sees them in
// the same diff and queues one Cloud Task each. Plain cook mode passes none, which
// is exactly why a timer started there never arms any.
//
// TWO OPERATIONS FUNNEL THROUGH HERE and they must not behave the same way. The
// discriminator is whether an entry with this id is ALREADY LIVE:
//
//   - NOT live — a fresh start. Whatever the caller anchored to this moment is
//     what gets armed, and any check-in left over from a previous run of the same
//     timer is dropped (restarting a timer restarts its reminders).
//   - ALREADY live — a re-time: same id, a new `endsAt`. The check-ins already
//     armed are KEPT AS THEY ARE and the supplied ones are ignored, because a
//     check-in's `endsAt` is anchored to the ORIGINAL start. That is the whole
//     point: extending a braise from three hours to four must not push the
//     twenty-minute heat check out to twenty-seven.
//
// Either way the surviving set is filtered the SAME way — keep every check-in
// whose `endsAt` still PRECEDES the main timer's — which gives shorten-drops /
// extend-keeps from one rule, and also refuses to arm a reminder that falls
// outside a duration the cook shortened at the moment of starting.
export function withTimerStarted(
  session: CookSessionDoc,
  timer: CookActiveTimerDoc,
  checkIns: readonly CookActiveTimerDoc[] = [],
): CookSessionDoc {
  const endsAtMs = Date.parse(timer.endsAt);
  const alreadyLive = session.activeTimers.some((t) => t.id === timer.id);
  const candidates = alreadyLive
    ? session.activeTimers.filter((t) => isCheckInOf(t.id, timer.id))
    : dedupeById(checkIns);
  const kept = candidates.filter((c) => Date.parse(c.endsAt) < endsAtMs);
  const others = session.activeTimers.filter(
    (t) => t.id !== timer.id && !isCheckInOf(t.id, timer.id),
  );
  return { ...session, activeTimers: [...others, timer, ...kept] };
}

// Two check-ins authored at the same minute would derive the same id. First one
// wins: two entries sharing a key would break the timers bar's keyed list, and a
// duplicate reminder is not worth a render error.
function dedupeById(entries: readonly CookActiveTimerDoc[]): CookActiveTimerDoc[] {
  const seen = new Set<string>();
  const out: CookActiveTimerDoc[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
