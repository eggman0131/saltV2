import { logger } from 'firebase-functions';
import { resolvePushoverTargets } from './pushoverRecipient.js';
import { sendPushover } from './sendPushover.js';

// Resolve one member's Pushover devices and send, for both timer kinds (#987).
// Every outcome is handled here so callers stay linear, and NOTHING escapes: a
// throw would put a dispatch into a Cloud Tasks retry it cannot win (Rule 10).
//
// `onBatchStageDispatch` is deliberately not a caller — it is web-push only.

// Why the timer did not reach Pushover, which is not the same question as whether
// it delivered. Only ONE non-delivery means "this person has no Pushover", and it
// is the only one that earns the cook timer's install nudge; the rest are our
// problem, or a passing one, and telling someone to install an app they already
// have would be worse than saying nothing. The nudge itself is the CALLER's, not
// this function's — see onCookTimerDispatch.
export type PushoverOutcome =
  // Sent. No web-push fallback for non-Apple devices.
  | 'delivered'
  // The account answered and nothing matched `<firstname>-`. The nudge case.
  | 'no-devices'
  // Not provisioned here, suppressed in non-production, a resolution blip, or a
  // failed send — all cases where they may well have Pushover already.
  | 'unavailable';

export interface PushoverDelivery {
  /** The calling function's name; the log prefix. */
  readonly name: string;
  readonly token: string;
  readonly user: string;
  readonly ownerUid: string;
  /** The kind's own log field — `{ sessionId }` for cook, `{ timerId }` for kitchen. */
  readonly context: Record<string, string>;
  /** Absolute deep link, or undefined when there is no project id to build one from. */
  readonly link: string | undefined;
  readonly linkTitle: string;
  readonly payload: { readonly title: string; readonly body: string };
}

export async function deliverViaPushover(d: PushoverDelivery): Promise<PushoverOutcome> {
  if (!d.token || !d.user) {
    // Not provisioned in this environment — web push covers everyone. NOT the
    // nudge case: this is our missing config, not their missing app.
    logger.warn(`${d.name}: Pushover not provisioned`, d.context);
    return 'unavailable';
  }

  const credentials = { token: d.token, user: d.user };
  const targets = await resolvePushoverTargets(credentials, d.ownerUid);

  switch (targets.kind) {
    case 'suppressed':
      // Non-production and not the test-device owner, or the emulator. Expected.
      return 'unavailable';

    case 'unresolved':
      // Operational blip (network / member read). Logged inside the resolver; not
      // reported, because an offline wobble is not the unexpected (§7.6).
      logger.warn(`${d.name}: Pushover targets unresolved`, {
        ...d.context,
        reason: targets.reason,
      });
      return 'unavailable';

    case 'no-devices':
      // Nothing matched `<firstname>-`, so we send NOTHING rather than let
      // Pushover fail open and broadcast one person's rice to the whole family.
      //
      // WARN, not report: a member who has simply not installed Pushover lands
      // here on every single timer, and reporting that would be a permanent alarm
      // for a working app — they fall back to web push. A genuinely mistyped
      // device name shows up in the /settings Pushover readout.
      logger.warn(`${d.name}: no Pushover device matched`, {
        ...d.context,
        firstName: targets.firstName,
      });
      return 'no-devices';

    case 'send': {
      // Spread rather than assign: under exactOptionalPropertyTypes an absent deep
      // link must be an absent PROPERTY, not an explicit undefined.
      const result = await sendPushover(credentials, targets.devices, {
        title: d.payload.title,
        body: d.payload.body,
        ...(d.link ? { url: d.link, urlTitle: d.linkTitle } : {}),
      });
      // A failed send is NOT reported: it routes this member to web push instead,
      // and the caller reports only if that leaves the timer undelivered to
      // everything. It is 'unavailable', never 'no-devices' — they demonstrably
      // HAVE Pushover, we just could not reach it this once.
      if (result === 'failed') logger.warn(`${d.name}: Pushover send failed`, d.context);
      return result === 'sent' ? 'delivered' : 'unavailable';
    }
  }
}
