import type { CookSessionDoc } from '../schemas/index.js';
import { isCheckInOf } from './checkInTimerId.js';

// Drop a running timer by its id (a step timer's id is its step id). Immutable,
// and unconditional: dismissing an id with no live timer yields an equal-but-new
// session rather than the same reference, which keeps a dismiss idempotent from
// the cook's point of view.
//
// A timer's guided check-ins go with it (issue #751, Phase 3). They are reminders
// PARTWAY THROUGH this timer's wait, so a wait that has been dismissed — or
// cancelled, which is the same write — has no partway left. Leaving them armed
// would page the cook about a braise they stopped. Dismissing a check-in itself
// still removes only that one: `isCheckInOf` never matches a check-in's own id.
export function withTimerDismissed(session: CookSessionDoc, timerId: string): CookSessionDoc {
  return {
    ...session,
    activeTimers: session.activeTimers.filter(
      (t) => t.id !== timerId && !isCheckInOf(t.id, timerId),
    ),
  };
}
