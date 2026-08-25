import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import {
  KitchenTimersSchema,
  type KitchenTimersDoc,
  type KitchenTimerDoc,
} from '@salt/domain/schemas';
import { KITCHEN_TIMER_REGION, type KitchenTimerTaskPayload } from './kitchenTimerTypes.js';
import { timerWriteTrigger } from './timerWriteTrigger.js';

const posthogApiKey = defineSecret('POSTHOG_API_KEY');

export type { KitchenTimerTaskPayload } from './kitchenTimerTypes.js';

// Enqueue trigger for standalone kitchen-timer push notifications (issue #842).
// The behaviour is `timerWriteTrigger`'s and documented there; this file is the
// kitchen kind's five values.
//
// This file used to argue that a full sibling of onCookTimerWrite was right
// because serving a second collection "would mean a document union and a fork at
// every step". Measured (#987), that is true of the DISPATCH side — which re-reads
// `cookSessions` and enriches from the recipe, against a one-document-per-user
// array here — and false of this one, which differed on five mechanical axes and
// needed no union at all. The dispatch handlers stay separate for exactly the
// reason that comment gave; the enqueue halves did not earn it.
//
// SECRETS ARE REQUIRED here, contrary to the note this replaces: enqueue touches
// neither AI nor push, but it reports and flushes server observability, and
// posthog-node needs POSTHOG_API_KEY bound to do either (#920). Without it the
// reporting silently no-ops, which is indistinguishable from a trigger that never
// failed — the exact gap the cook trigger's history records. memory/region pinned
// INLINE because this module is evaluated before index.ts's setGlobalOptions runs.
export const onKitchenTimerWrite = onDocumentWritten(
  {
    secrets: [posthogApiKey],
    document: 'kitchenTimers/{uid}',
    region: KITCHEN_TIMER_REGION,
    memory: '512MiB',
  },
  timerWriteTrigger<{ uid: string }, KitchenTimersDoc, KitchenTimerDoc, KitchenTimerTaskPayload>({
    name: 'onKitchenTimerWrite',
    schema: KitchenTimersSchema,
    timersOf: (doc) => doc.timers,
    paramName: 'uid',
    region: KITCHEN_TIMER_REGION,
    queueFunctionName: 'onKitchenTimerDispatch',
    payloadOf: (uid, t) => ({ uid, timerId: t.id, endsAt: t.endsAt }),
  }),
);
