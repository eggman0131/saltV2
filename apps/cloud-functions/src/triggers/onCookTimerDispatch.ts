import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  CookSessionSchema,
  PushSubscriptionSchema,
  RecipeSchema,
  type CookActiveTimerDoc,
} from '@salt/domain/schemas';
import { sendWebPush, isApplePushEndpoint } from '../adapters/sendWebPush.js';
import { deliverViaPushover } from '../adapters/deliverViaPushover.js';
import { reportServerError } from '../observability/reportServerError.js';
import { COOK_TIMER_REGION, type CookTimerTaskPayload } from './cookTimerTypes.js';
import { timerDeliveryStamp } from './timerDeliveryRetention.js';
import { withTaskTrigger } from './triggerEntrypoint.js';

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

// NO install nudge rides the fallback push (#988, option 3 of 3). There used to
// be a per-notification line here — "install Pushover in Settings for on-time
// timers" — appended when a non-Apple device took the fallback because the
// member had no Pushover devices. The standalone kitchen timer (#842) shipped
// without it, and #988 asked whether to extend it there; the decision was to
// carry it NOWHERE instead: a repeated upsell on every degraded timer wears out,
// and the /settings Pushover readout already names this exact state — the
// empty-devices warning there is the ONE place the install advice lives now.
// If a shared fan-out (#987) or a new dispatcher tempts you to re-add a
// per-notification nudge, that is re-opening #988, not restoring an oversight.

// The live recipe, or null on absolutely any failure (missing, corrupt, or a read
// that threw). Never throws — a name we cannot fetch must never cost us the
// notification itself, which is the only time-critical part.
async function readRecipe(recipeId: string) {
  try {
    const snap = await getFirestore().collection('recipes').doc(recipeId).get();
    if (!snap.exists) return null;
    const parsed = RecipeSchema.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  } catch (err) {
    logger.warn('onCookTimerDispatch: could not read the recipe', { recipeId, err });
    return null;
  }
}

// Names the timer and the cook it belongs to, e.g. "Simmer the sauce" /
// "Shepherd's pie". Neither is in the task payload, so this costs ONE extra
// Firestore read on the dispatch path.
//
// The timer's OWN `label` wins: since #748 a timer carries the name it was
// started with, and that is exactly what the in-app chip shows — a notification
// that named a timer differently from the screen it deep-links to would be worse
// than one that named nothing. Only when there is no label (a legacy entry
// written before the field existed) do we fall back to the step's
// `timer.description`, then `Step N`, then the generic copy. An ad-hoc timer has
// a null `stepId` and no step to look up at all, so the lookup is skipped.
//
// Returns null when nothing can be named, and the caller falls back to the
// generic copy.
async function describeCookTimer(
  recipeId: string,
  timer: CookActiveTimerDoc,
): Promise<{ readonly title: string; readonly body: string } | null> {
  const recipe = await readRecipe(recipeId);
  if (!recipe && !timer.label) return null;

  const steps = recipe?.steps ?? [];
  const index = timer.stepId === null ? -1 : steps.findIndex((s) => s.id === timer.stepId);
  const stepLabel = index >= 0 ? (steps[index]?.timer?.description ?? null) : null;

  return {
    title: timer.label ?? stepLabel ?? (index >= 0 ? `Step ${index + 1}` : FALLBACK_COPY.title),
    body: recipe?.title ?? FALLBACK_COPY.body,
  };
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
  withTaskTrigger<CookTimerTaskPayload>(async (req) => {
    const { sessionId, timerId, endsAt } = req.data;
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

      // (b) Confirm the timer STILL matches. If it was removed, extended or
      // shortened (different endsAt), this is a stale task → no-op. This is also
      // where a task queued with the PRE-#748 payload shape lands: it carries no
      // `timerId`, matches nothing, and its push is silently missed. Accepted —
      // see the note on CookTimerTaskPayload.
      const timer = session.activeTimers.find((t) => t.id === timerId && t.endsAt === endsAt);
      if (!timer) return;

      // (c) Exactly-once claim via a SEPARATE server-owned ledger doc — NEVER a
      // write-back onto cookSessions (a client setDoc would clobber it under LWW).
      // A duplicate dispatch (Cloud Tasks at-least-once, or a retry) finds the
      // ledger doc already present and bails.
      const endsAtMs = new Date(endsAt).getTime();
      const ledgerRef = db.collection('timerDeliveries').doc(`${sessionId}_${timerId}_${endsAtMs}`);
      let alreadyDelivered = false;
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(ledgerRef);
        if (existing.exists) {
          alreadyDelivered = true;
          return;
        }
        tx.set(ledgerRef, { ...timerDeliveryStamp(), sessionId, timerId });
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
      const copy = (await describeCookTimer(session.recipeId, timer)) ?? FALLBACK_COPY;
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
      // The Pushover message DOES carry the recipe title, the timer label and a
      // deep link containing the recipe id, reversing the original #680 stance
      // that nothing but fixed copy may cross to a third party. That was an
      // explicit product call: a timer you cannot identify from the lock screen —
      // which cook, which timer, with no way back — is most of the value gone,
      // and the exposure is one family's dinner. Do not re-tighten this without
      // asking; it is a decision, not a slip.
      const pushoverOutcome = await deliverViaPushover({
        name: 'onCookTimerDispatch',
        token: pushoverAppToken.value(),
        user: pushoverUserKey.value(),
        ownerUid: session.ownerUid,
        context: { sessionId },
        link: cookDeepLink(session.recipeId),
        linkTitle: 'Back to the cook',
        payload,
      });
      const pushoverDelivered = pushoverOutcome === 'delivered';

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
          const isApple = isApplePushEndpoint(data.endpoint);
          if (!isApple && pushoverDelivered) continue;

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
    }
  }),
);
