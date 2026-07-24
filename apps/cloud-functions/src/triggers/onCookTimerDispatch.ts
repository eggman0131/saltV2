import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { CookSessionSchema, PushSubscriptionSchema } from '@salt/domain/schemas';
import { flushServerObservability } from '@salt/observability/server';
import { sendWebPush } from '../adapters/sendWebPush.js';
import { reportServerError } from '../observability/reportServerError.js';
import type { CookTimerTaskPayload } from './cookTimerTypes.js';

// Cloud Task handler that actually sends the cook-timer push (issue #544). Fires
// at the scheduled endsAt of a timer enqueued by onCookTimerWrite. The whole body
// is wrapped so a permanent error is REPORTED and swallowed — throwing out of an
// onTaskDispatched handler makes Cloud Tasks retry (up to maxAttempts), which for
// a deterministic failure is pure noise.
//
// Defined locally (not imported from index.ts) to avoid a circular import; the
// Firebase CLI aggregates same-named defineSecret calls across files at deploy.
// VAPID keypair signs the push (the public key is not sensitive, but this repo
// has no non-secret function-env mechanism — deployed functions read config only
// from Secret Manager — so it rides as a secret alongside the private key rather
// than a would-be-empty process.env var). PostHog key powers error reporting.
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY');
const vapidPublicKey = defineSecret('VAPID_PUBLIC_KEY');
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

export const onCookTimerDispatch = onTaskDispatched<CookTimerTaskPayload>(
  {
    region: 'europe-west2',
    memory: '512MiB',
    secrets: [vapidPrivateKey, vapidPublicKey, posthogApiKey],
    // A push endpoint can be transiently unavailable; retry a handful of times
    // with backoff. A PERMANENT failure never throws (see below), so it never
    // burns retries.
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 5 },
    // Cap fan-out so a burst of timers can't stampede the push services.
    rateLimits: { maxConcurrentDispatches: 6 },
  },
  async (req) => {
    const { sessionId, stepId, endsAt } = req.data;
    const db = getFirestore();

    try {
      // (a) Re-read the LIVE session. Absent → the cook ended / timer was cleared
      // (the cancellation-free design: we never delete tasks, we no-op stale ones).
      const sessionSnap = await db.collection('cookSessions').doc(sessionId).get();
      if (!sessionSnap.exists) return;

      const parsed = CookSessionSchema.safeParse(sessionSnap.data());
      if (!parsed.success) {
        logger.error('onCookTimerDispatch: invalid cookSession doc, skipping', {
          sessionId,
          error: parsed.error.message,
        });
        return;
      }
      const session = parsed.data;

      // (b) Confirm the timer STILL matches. If it was removed or extended
      // (different endsAt), this is a stale task → no-op.
      const stillArmed = session.activeTimers.some(
        (t) => t.stepId === stepId && t.endsAt === endsAt,
      );
      if (!stillArmed) return;

      // (c) Exactly-once claim via a SEPARATE server-owned ledger doc — NEVER a
      // write-back onto cookSessions (a client setDoc would clobber it under LWW).
      // A duplicate dispatch (Cloud Tasks at-least-once, or a retry) finds the
      // ledger doc already present and bails.
      const endsAtMs = new Date(endsAt).getTime();
      const ledgerRef = db.collection('timerDeliveries').doc(`${sessionId}_${stepId}_${endsAtMs}`);
      let alreadyDelivered = false;
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(ledgerRef);
        if (existing.exists) {
          alreadyDelivered = true;
          return;
        }
        tx.set(ledgerRef, { deliveredAt: Date.now(), sessionId, stepId });
      });
      if (alreadyDelivered) return;

      // (d) Fetch the owner's device subscriptions; skip any that fail validation.
      const subsSnap = await db
        .collection('pushSubscriptions')
        .where('ownerUid', '==', session.ownerUid)
        .get();
      const subscriptions = subsSnap.docs
        .map((doc) => ({ ref: doc.ref, parsed: PushSubscriptionSchema.safeParse(doc.data()) }))
        .filter((s) => s.parsed.success);

      // (e) VAPID material. Both keys come from bound secrets; the subject is a
      // fixed contact (a valid mailto is all web-push needs). If either key is
      // empty the feature is not provisioned — log and return rather than throw
      // (a retry wouldn't help).
      const publicKey = vapidPublicKey.value();
      const privateKey = vapidPrivateKey.value();
      const subject = 'mailto:admin@salt.app';
      if (!publicKey || !privateKey) {
        logger.error('onCookTimerDispatch: VAPID not provisioned', { sessionId });
        return;
      }

      // (f) IDS + GENERIC COPY ONLY — never recipe/step free-text. The service
      // worker renders a fixed notification and uses `tag` to collapse repeats and
      // `sessionId` to deep-link back to the cook.
      const payload = {
        type: 'cook-timer' as const,
        tag: `cook::${sessionId}`,
        sessionId,
        title: 'Timer finished',
        body: 'A cook timer just finished.',
      };

      // (g) Send to every valid subscription; prune the dead, report the failed.
      for (const sub of subscriptions) {
        if (!sub.parsed.success) continue; // narrowing (filtered above)
        const data = sub.parsed.data;
        const result = await sendWebPush(
          { subject, publicKey, privateKey },
          { endpoint: data.endpoint, keys: data.keys },
          payload,
        );
        if (result === 'gone') {
          // Subscription is permanently dead — prune it so we stop trying.
          await sub.ref.delete();
        } else if (result === 'failed') {
          // Transient/unexpected send failure. No user content in the error.
          reportServerError(new Error('web-push send failed'));
        }
      }
    } catch (err) {
      // Never throw out of the handler — a permanent error would otherwise make
      // Cloud Tasks retry to exhaustion. Report and return.
      logger.error('onCookTimerDispatch: unexpected error', { sessionId, err });
      reportServerError(err);
    } finally {
      await flushServerObservability();
    }
  },
);
