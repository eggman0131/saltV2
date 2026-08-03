import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { CookSessionSchema, PushSubscriptionSchema, RecipeSchema } from '@salt/domain/schemas';
import { flushServerObservability } from '@salt/observability/server';
import { sendWebPush, isApplePushEndpoint } from '../adapters/sendWebPush.js';
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
// Returns whether the timer ACTUALLY reached Pushover, which is what decides the
// web-push fan-out that follows (see the routing note on the handler). Every
// non-delivery — unprovisioned, suppressed, unresolved, no devices, a failed
// send — returns false, so web push covers the gap in all of them. That is what
// makes the rollout-safe cases work: staging suppresses Pushover, and the
// emulator refuses it outright, and both still notify.
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
): Promise<boolean> {
  const token = pushoverAppToken.value();
  const user = pushoverUserKey.value();
  if (!token || !user) {
    // Not provisioned in this environment — web push covers everyone.
    logger.warn('onCookTimerDispatch: Pushover not provisioned', { sessionId });
    return false;
  }

  const targets = await resolvePushoverTargets({ token, user }, ownerUid);

  switch (targets.kind) {
    case 'suppressed':
      // Non-production, and this member is not the test-device owner. Expected.
      return false;

    case 'unresolved':
      // Operational blip (network / member read). Logged inside the resolver;
      // not reported, because an offline wobble is not the unexpected (§7.6).
      logger.warn('onCookTimerDispatch: Pushover targets unresolved', {
        sessionId,
        reason: targets.reason,
      });
      return false;

    case 'no-devices':
      // No device matched `<firstname>-`, so we send NOTHING rather than let
      // Pushover fail open and broadcast one person's rice to the whole family.
      //
      // WARN, not report: this is now an ordinary state, not a misconfiguration.
      // A member who simply has not installed Pushover lands here on every single
      // timer, and reporting that would be a permanent alarm for a working app —
      // they fall back to web push below. A genuinely mistyped device name shows
      // up in the /settings Pushover readout, which names what did match.
      logger.warn('onCookTimerDispatch: no Pushover device matched', {
        sessionId,
        firstName: targets.firstName,
      });
      return false;

    case 'send': {
      // Spread rather than assign: under exactOptionalPropertyTypes an absent
      // deep link must be an absent PROPERTY, not an explicit undefined.
      const link = cookDeepLink(recipeId);
      const result = await sendPushover({ token, user }, targets.devices, {
        title: payload.title,
        body: payload.body,
        ...(link ? { url: link, urlTitle: 'Back to the cook' } : {}),
      });
      // A failed send is NOT reported here any more: returning false routes this
      // member to web push instead, and the handler reports only if that leaves
      // the timer undelivered to everything.
      if (result === 'failed') {
        logger.warn('onCookTimerDispatch: Pushover send failed', { sessionId });
      }
      return result === 'sent';
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
      // for BOTH sinks: a device may legitimately be reached by either, and a
      // named notification beside an anonymous one would just read as a bug.
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

      // (g) PUSHOVER FIRST. It is the primary channel — a native client gets the
      // high-priority wake that Chrome's push path does not — and whether it
      // delivered decides the web-push fan-out below, so it has to run first.
      const pushoverDelivered = await deliverViaPushover(
        session.ownerUid,
        sessionId,
        session.recipeId,
        payload,
      );

      // (h) WEB PUSH, ROUTED PER DEVICE. The two sinks no longer both fire for
      // everyone (they did during the #680 rollout); each device now gets exactly
      // one channel, chosen by the only per-device signal we have — the push
      // endpoint's host:
      //
      //   Apple endpoint  → ALWAYS. APNs wakes an iPhone/iPad reliably, and this
      //                     is the channel that measurably works there. It is
      //                     sent even when Pushover delivered, because Pushover
      //                     may have reached a DIFFERENT device (an Android
      //                     phone) — the two are not duplicates of each other.
      //   everything else → ONLY as a FALLBACK, when Pushover did not deliver.
      //                     Android web push is throttled into uselessness by
      //                     Doze and per-OEM battery management, so it is the
      //                     channel of last resort, not the default. Someone who
      //                     has not set up Pushover still gets a notification;
      //                     the day they install it, this stops on its own.
      //
      // No schema or client change makes this work, and nothing here needs to
      // know about platforms — install Pushover and the fallback retires itself.
      let webPushDelivered = 0;
      if (webPushProvisioned) {
        for (const sub of subscriptions) {
          if (!sub.parsed.success) continue; // narrowing (filtered above)
          const data = sub.parsed.data;
          if (!isApplePushEndpoint(data.endpoint) && pushoverDelivered) continue;

          const result = await sendWebPush(
            { subject, publicKey, privateKey },
            { endpoint: data.endpoint, keys: data.keys },
            payload,
          );
          if (result === 'sent') {
            webPushDelivered += 1;
          } else if (result === 'gone') {
            // Subscription is permanently dead — prune it so we stop trying.
            await sub.ref.delete();
          } else {
            // Transient/unexpected send failure. No user content in the error.
            reportServerError(new Error('web-push send failed'));
          }
        }
      }

      // (i) Report ONLY total non-delivery. Neither sink failing alone is worth an
      // alert now that each is the other's backstop — but a timer that reached
      // nothing at all is a person standing over a pan waiting for a ping that is
      // never coming, which is the one failure of this feature that matters.
      if (!pushoverDelivered && webPushDelivered === 0) {
        reportServerError(
          new Error('Cook timer reached no device — neither Pushover nor web push'),
        );
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
