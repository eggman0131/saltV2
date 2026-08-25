import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import {
  CookSessionSchema,
  type CookSessionDoc,
  type CookActiveTimerDoc,
} from '@salt/domain/schemas';
import { COOK_TIMER_REGION, type CookTimerTaskPayload } from './cookTimerTypes.js';
import { timerWriteTrigger } from './timerWriteTrigger.js';

const posthogApiKey = defineSecret('POSTHOG_API_KEY');

export type { CookTimerTaskPayload } from './cookTimerTypes.js';

// Enqueue trigger for cook-timer push notifications (issue #544). The behaviour
// is `timerWriteTrigger`'s and documented there; this file is the cook kind's
// five values.
//
// Enqueue touches neither AI nor push, but it DOES report and flush server
// observability — and posthog-node needs POSTHOG_API_KEY bound to do either, so
// the secret is declared (#920). Without it the reporting in this trigger silently
// no-ops, which is indistinguishable from a trigger that never failed. The comment
// that used to sit here said "no secrets here" and was the reason the gap survived.
// memory/region pinned INLINE because this module is evaluated before index.ts's
// setGlobalOptions runs (same reason the other triggers pin them inline).
export const onCookTimerWrite = onDocumentWritten(
  {
    secrets: [posthogApiKey],
    document: 'cookSessions/{sessionId}',
    region: COOK_TIMER_REGION,
    memory: '512MiB',
  },
  timerWriteTrigger<
    { sessionId: string },
    CookSessionDoc,
    CookActiveTimerDoc,
    CookTimerTaskPayload
  >({
    name: 'onCookTimerWrite',
    schema: CookSessionSchema,
    timersOf: (session) => session.activeTimers,
    paramName: 'sessionId',
    region: COOK_TIMER_REGION,
    queueFunctionName: 'onCookTimerDispatch',
    payloadOf: (sessionId, t) => ({ sessionId, timerId: t.id, endsAt: t.endsAt }),
  }),
);
