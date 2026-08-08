import type { CookActiveTimerDoc, CookSessionDoc } from '../schemas/index.js';

// Start (or restart) a countdown. The WHOLE entry is supplied by the caller —
// `endsAt` is an ABSOLUTE ISO end-time and `id` is minted outside, never computed
// from a clock or a random source here (CLAUDE.md Rule 1). The absolute end-time
// is what lets a reload or a device switch reconstruct the remaining time with no
// extra client state.
//
// Takes the entry rather than a widening list of positional arguments: a timer now
// carries an id, a nullable step, a label and the duration it was actually started
// for, and six positional parameters would be unreadable at every call site.
//
// ONE live timer per id: any existing entry with the same `id` is replaced, and
// the new entry is appended so the timers bar orders by most-recently-started.
// Since a step timer's id IS its step id, that still means one timer per step.
export function withTimerStarted(
  session: CookSessionDoc,
  timer: CookActiveTimerDoc,
): CookSessionDoc {
  return {
    ...session,
    activeTimers: [...session.activeTimers.filter((t) => t.id !== timer.id), timer],
  };
}
