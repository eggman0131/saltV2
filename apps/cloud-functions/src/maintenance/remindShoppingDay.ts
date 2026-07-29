import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  ShoppingDaySchema,
  ShoppingListsConfigSchema,
  PushSubscriptionSchema,
} from '@salt/domain/schemas';
import { tomorrowInZone } from '@salt/domain';
import { flushServerObservability } from '@salt/observability/server';
import { sendWebPush } from '../adapters/sendWebPush.js';
import { reportServerError } from '../observability/reportServerError.js';

// Daily "shopping tomorrow" nudge (issue #629).
//
// WHY 17:00 THE NIGHT BEFORE, FOR BOTH SLOTS — the shopping list only works if it
// is up to date BEFORE someone leaves for the shops, and this is a household
// where people are often at work in the morning, so an evening ping is the one
// that reliably lands. For a PM shop it simply gives more notice, which costs
// nothing. `slot` drives COPY ONLY, never timing; one check a day is enough.
//
// THE NUDGE ALWAYS SENDS, whatever is on the list — an empty list is precisely
// when the reminder matters most, so there is no "list is non-empty" gate.
//
// COST SHAPE — one `get` by deterministic id per day. `shoppingDays/{tomorrow}`
// is keyed by the calendar date, so there is no collection scan, no query and no
// index; on the ~6 days a week with no shop the function returns after a single
// document read.
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY');
const vapidPublicKey = defineSecret('VAPID_PUBLIC_KEY');
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// The cron fires at 17:00 in this zone and "tomorrow" is computed in the SAME
// zone, so the two can never disagree. onSchedule's timeZone is a deploy-time
// constant that cannot be driven from Firestore, which is why this is not read
// from `appSettings.homeLocation.timezone` — that field exists to anchor the
// weather forecast, and coupling a cron to it would buy nothing while letting the
// two zones drift apart. Same precedent as sweepOrphanedStorage.
const REMINDER_TIME_ZONE = 'Europe/London';

export const remindShoppingDay = onSchedule(
  {
    schedule: '0 17 * * *',
    timeZone: REMINDER_TIME_ZONE,
    region: 'europe-west2',
    memory: '512MiB',
    secrets: [vapidPrivateKey, vapidPublicKey, posthogApiKey],
    // NO EXACTLY-ONCE LEDGER, unlike the cook timer (#544). A once-daily cron
    // with retryCount: 0 has one realistic duplicate source — a rare Cloud
    // Scheduler double-delivery — and the notification `tag` already collapses
    // that: the second push REPLACES the first rather than stacking, and with
    // renotify: false it does not re-buzz. #544 needed a real ledger because a
    // cook timer is audible, time-critical and dispatched via at-least-once
    // Cloud Tasks with 5 retries; none of that applies here. This avoids a
    // collection, a rules block and a transaction.
    retryCount: 0,
  },
  async () => {
    const db = getFirestore();
    try {
      // (a) Is there a shop tomorrow? One doc read by id — the whole daily cost.
      const date = tomorrowInZone(new Date(), REMINDER_TIME_ZONE);
      const daySnap = await db.collection('shoppingDays').doc(date).get();
      if (!daySnap.exists) return;

      const parsedDay = ShoppingDaySchema.safeParse(daySnap.data());
      if (!parsedDay.success) {
        // A trigger/schedule has no caller to surface a Failure to: log and return.
        logger.error('remindShoppingDay: invalid shoppingDay doc, skipping', {
          date,
          error: parsedDay.error.message,
        });
        return;
      }
      const { slot } = parsedDay.data;

      // (b) Which list does the notification open? Only the WEEKLY SHOP is
      // reminded — the other lists are background collectors for specialist
      // stores, shopped whenever, and they stay silent. An unset/absent default
      // still notifies; the deep link just lands on the list index.
      const configSnap = await db.collection('shoppingListsConfig').doc('singleton').get();
      const parsedConfig = ShoppingListsConfigSchema.safeParse(configSnap.data() ?? {});
      const defaultListId = parsedConfig.success ? parsedConfig.data.defaultListId : '';

      // (c) VAPID material, exactly as onCookTimerDispatch resolves it. Missing
      // keys mean the feature is not provisioned in this environment — log and
      // return rather than throw (Scheduler would only replay the same failure).
      const publicKey = vapidPublicKey.value();
      const privateKey = vapidPrivateKey.value();
      const subject = 'mailto:admin@salt.app';
      if (!publicKey || !privateKey) {
        logger.error('remindShoppingDay: VAPID not provisioned', { date });
        return;
      }

      // (d) IDS + GENERIC COPY ONLY (the #544 no-free-text rule): the list's
      // user-typed `name` never enters the transport. `renotify: false` and the
      // date-keyed `tag` let a duplicate push replace this one silently.
      const payload = {
        type: 'shopping-reminder' as const,
        tag: `shopping::${date}`,
        url: defaultListId ? `/#/shopping/${defaultListId}` : '/#/shopping',
        title: `Shopping tomorrow ${slot.toUpperCase()}`,
        body: 'Add anything missing to the list.',
        renotify: false,
      };

      // (e) BROADCAST — every device in pushSubscriptions, not one user's. The
      // shop is a household fact, so everyone with notifications on gets the
      // nudge. Read via the Admin SDK, which bypasses the owner-scoped rules.
      const subsSnap = await db.collection('pushSubscriptions').get();
      let sent = 0;
      let pruned = 0;
      for (const subDoc of subsSnap.docs) {
        const parsedSub = PushSubscriptionSchema.safeParse(subDoc.data());
        if (!parsedSub.success) continue; // skip-invalid; one bad doc must not stop the broadcast
        const result = await sendWebPush(
          { subject, publicKey, privateKey },
          { endpoint: parsedSub.data.endpoint, keys: parsedSub.data.keys },
          payload,
        );
        if (result === 'gone') {
          // Permanently dead subscription (404/410) — prune so we stop trying.
          await subDoc.ref.delete();
          pruned += 1;
        } else if (result === 'failed') {
          // Transient/unexpected send failure. No user content in the error.
          reportServerError(new Error('web-push send failed'));
        } else {
          sent += 1;
        }
      }

      logger.info('remindShoppingDay: reminded', { date, slot, sent, pruned });
    } catch (err) {
      // Never throw out of a scheduled handler (Rule 10): there is no caller, and
      // Scheduler would replay a deterministic failure. Report and let tomorrow's
      // run try again — SyncError, the unexpected-infrastructure class.
      logger.error('remindShoppingDay: reminder failed', { error: String(err) });
      reportServerError(err, 'SyncError');
    } finally {
      await flushServerObservability();
    }
  },
);
