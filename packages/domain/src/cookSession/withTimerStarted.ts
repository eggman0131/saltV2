import type { CookSessionDoc } from '../schemas/index.js';

// Start (or restart) a step's countdown. `endsAt` is an ABSOLUTE ISO end-time
// supplied by the caller — never computed from the clock here (CLAUDE.md Rule 1) —
// which is what lets a reload or a device switch reconstruct the remaining time
// with no extra client state.
//
// ONE live timer per step: any existing entry for `stepId` is replaced, and the
// new entry is appended so the timers bar orders by most-recently-started.
export function withTimerStarted(
  session: CookSessionDoc,
  stepId: string,
  endsAt: string,
  notify: boolean,
): CookSessionDoc {
  return {
    ...session,
    activeTimers: [
      ...session.activeTimers.filter((t) => t.stepId !== stepId),
      { stepId, endsAt, notify },
    ],
  };
}
