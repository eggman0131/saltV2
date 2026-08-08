import type { CookSessionDoc } from '../schemas/index.js';

// Drop a running timer by its id (a step timer's id is its step id). Immutable,
// and unconditional: dismissing an id with no live timer yields an equal-but-new
// session rather than the same reference, which keeps a dismiss idempotent from
// the cook's point of view.
export function withTimerDismissed(session: CookSessionDoc, timerId: string): CookSessionDoc {
  return { ...session, activeTimers: session.activeTimers.filter((t) => t.id !== timerId) };
}
