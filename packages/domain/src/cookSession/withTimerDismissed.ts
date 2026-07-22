import type { CookSessionDoc } from '../schemas/index.js';

// Drop a step's running timer. Immutable, and unconditional: dismissing a step
// with no live timer yields an equal-but-new session rather than the same
// reference, which keeps a dismiss idempotent from the cook's point of view.
export function withTimerDismissed(session: CookSessionDoc, stepId: string): CookSessionDoc {
  return { ...session, activeTimers: session.activeTimers.filter((t) => t.stepId !== stepId) };
}
