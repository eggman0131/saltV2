import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { CookSessionSchema, PushSubscriptionSchema, RecipeSchema } from '@salt/domain/schemas';
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

// Generic copy — what a notification says when the recipe could not be read.
const FALLBACK_COPY = { title: 'Timer finished', body: 'A cook timer just finished.' } as const;

// Names the timer and the cook it belongs to, e.g. "Simmer the sauce" /
// "Shepherd's pie". Neither is in the task payload, so this costs ONE extra
// Firestore read on the dispatch path.
//
// The label is `steps[i].timer.description` falling back to `Step N`, which is
// EXACTLY what the in-app timer chip shows (CookModePage) — a notification that
// named a timer differently from the screen it deep-links to would be worse than
// one that named nothing.
//
// Returns null on absolutely any failure, and the caller falls back to the
// generic copy: a missing recipe title must never cost us the notification
// itself, which is the only part that is time-critical. Never throws.
async function describeCookTimer(
  recipeId: string,
  stepId: string,
): Promise<{ readonly title: string; readonly body: string } | null> {
  try {
    const snap = await getFirestore().collection('recipes').doc(recipeId).get();
    if (!snap.exists) return null;

    const parsed = RecipeSchema.safeParse(snap.data());
    if (!parsed.success) return null;

    const { steps, title } = parsed.data;
    const index = steps.findIndex((s) => s.id === stepId);
    const label = index >= 0 ? (steps[index]?.timer?.description ?? null) : null;

    return {
      title: label ?? (index >= 0 ? `Step ${index + 1}` : FALLBACK_COPY.title),
      body: title,
    };
  } catch (err) {
    logger.warn('onCookTimerDispatch: could not name the timer', { recipeId, err });
    return null;
  }
}

// Absolute deep link back into the cook, for the Pushover `url` (a native client
// opens it, so a path would have no origin to resolve against). Hosting is
// `<projectId>.web.app` in all three environments and GCLOUD_PROJECT is set by the
// Functions runtime, so this needs no new configuration. Undefined when there is
// no project id (local unit runs) — the notification still sends, just unlinked.
function cookDeepLink(recipeId: string): string | undefined {
  const projectId = process.env['GCLOUD_PROJECT'] ?? process.env['GCP_PROJECT'] ?? '';
  if (!projectId) return undefined;
  // Hash-routed app, matching the notificationclick route in push-sw.js.
  return `https://${projectId}.web.app/#/recipes/${recipeId}/cook`;
}

// Resolve the owner's Pushover devices and send. Every outcome is handled here
// so the caller stays linear, and NOTHING escapes: a throw would put the whole
// dispatch into a Cloud Tasks retry it cannot win.
//
// This message DOES carry the recipe title, the timer label and a deep link
// containing the recipe id, which reverses the original #680 stance that nothing
// but fixed copy may cross to a third party. That was an explicit product call:
// a timer you cannot identify from the lock screen — which cook, which timer,
// with no way back — is most of the value gone, and the exposure is one family's
// dinner. Do not re-tighten this without asking; it is a decision, not a slip.
async function deliverViaPushover(
  ownerUid: string,
  sessionId: string,
  recipeId: string,
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
      // Spread rather than assign: under exactOptionalPropertyTypes an absent
      // deep link must be an absent PROPERTY, not an explicit undefined.
      const link = cookDeepLink(recipeId);
      const result = await sendPushover({ token, user }, targets.devices, {
        title: payload.title,
        body: payload.body,
        ...(link ? { url: link, urlTitle: 'Back to the cook' } : {}),
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

      // (f) Name the timer and the cook — "Simmer the sauce" / "Shepherd's pie" —
      // falling back to the generic copy if the recipe cannot be read. ONE copy
      // for BOTH sinks: they fire for the same timer during the rollout, and one
      // named notification beside one anonymous one would just read as a bug.
      // The service worker renders whatever it is given, using `tag` to collapse
      // repeats and `sessionId` to deep-link back to the cook.
      const copy = (await describeCookTimer(session.recipeId, stepId)) ?? FALLBACK_COPY;
      const payload = {
        type: 'cook-timer' as const,
        tag: `cook::${sessionId}`,
        sessionId,
        title: copy.title,
        body: copy.body,
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
      await deliverViaPushover(session.ownerUid, sessionId, session.recipeId, payload);
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
