import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { CookSessionSchema, PushSubscriptionSchema } from '@salt/domain/schemas';
import { flushServerObservability } from '@salt/observability/server';
import { sendWebPush } from '../adapters/sendWebPush.js';
import { sendPushover } from '../adapters/sendPushover.js';
import { resolvePushoverTargets } from '../adapters/pushoverRecipient.js';
import { reportServerError } from '../observability/reportServerError.js';
import { COOK_TIMER_REGION, type CookTimerTaskPayload } from './cookTimerTypes.js';

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
// Pushover credentials are ONE SHARED FAMILY ACCOUNT (issue #680), so they are
// app-level secrets exactly like the VAPID pair — no per-user identity data is
// stored anywhere, and per-person targeting is the `device` parameter.
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY');
const vapidPublicKey = defineSecret('VAPID_PUBLIC_KEY');
const pushoverAppToken = defineSecret('PUSHOVER_APP_TOKEN');
const pushoverUserKey = defineSecret('PUSHOVER_USER_KEY');
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// Resolve the owner's Pushover devices and send. Every outcome is handled here
// so the caller stays linear, and NOTHING escapes: a throw would put the whole
// dispatch into a Cloud Tasks retry it cannot win.
//
// The GENERIC COPY discipline of the web-push payload applies here too, and more
// strictly: the message crosses to a third party, so it carries the fixed title
// and body ONLY — never the sessionId (which by design embeds the recipe id),
// the step id, or any recipe text.
async function deliverViaPushover(
  ownerUid: string,
  sessionId: string,
  payload: { readonly title: string; readonly body: string },
): Promise<void> {
  const token = pushoverAppToken.value();
  const user = pushoverUserKey.value();
  if (!token || !user) {
    // Not provisioned in this environment — web push above still ran.
    logger.warn('onCookTimerDispatch: Pushover not provisioned', { sessionId });
    return;
  }

  const targets = await resolvePushoverTargets({ token, user }, ownerUid);

  switch (targets.kind) {
    case 'suppressed':
      // Non-production, and this member is not the test-device owner. Expected.
      return;

    case 'unresolved':
      // Operational blip (network / member read). Logged inside the resolver;
      // not reported, because an offline wobble is not the unexpected (§7.6).
      logger.warn('onCookTimerDispatch: Pushover targets unresolved', {
        sessionId,
        reason: targets.reason,
      });
      return;

    case 'no-devices':
      // MISCONFIGURATION, and the whole reason the zero-match guard exists: no
      // device matched `<firstname>-`, so we send NOTHING rather than let
      // Pushover fail open and broadcast one person's rice to the whole family.
      // Reported, because silence is what would make this invisible for weeks.
      reportServerError(
        new Error(`Pushover: no devices matched '${targets.firstName}-' — timer not delivered`),
      );
      return;

    case 'send': {
      const result = await sendPushover({ token, user }, targets.devices, {
        title: payload.title,
        body: payload.body,
      });
      if (result === 'failed') {
        reportServerError(new Error('Pushover send failed'));
      }
      return;
    }
  }
}

export const onCookTimerDispatch = onTaskDispatched<CookTimerTaskPayload>(
  {
    region: COOK_TIMER_REGION,
    memory: '512MiB',
    secrets: [vapidPrivateKey, vapidPublicKey, pushoverAppToken, pushoverUserKey, posthogApiKey],
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
      // empty web push is not provisioned — log and skip that sink. It is no
      // longer a reason to abandon the dispatch: Pushover is an independent sink
      // and is the one we actually expect to arrive on time.
      const publicKey = vapidPublicKey.value();
      const privateKey = vapidPrivateKey.value();
      const subject = 'mailto:admin@salt.app';
      const webPushProvisioned = Boolean(publicKey && privateKey);
      if (!webPushProvisioned) {
        logger.error('onCookTimerDispatch: VAPID not provisioned', { sessionId });
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
      // BOTH sinks fire during the #680 rollout — Pushover ships ALONGSIDE web
      // push, not instead of it. Duplicate notifications for a short period are a
      // cheap price for confirming the delivery timing genuinely improves on the
      // real devices before the fallback comes out.
      if (webPushProvisioned) {
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
      }

      // (h) Pushover — the sink that actually wakes a dozing Android device.
      // Wrapped so a Pushover failure can never cost us the web-push send above
      // or trip the outer catch into a Cloud Tasks retry.
      await deliverViaPushover(session.ownerUid, sessionId, payload);
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
