import { onCall, HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { APP_CHECK_ENFORCEMENT } from '../tracedCallable.js';
import { resolvePushoverTargets } from '../adapters/pushoverRecipient.js';
import { reportServerError } from '../observability/reportServerError.js';

// Read-only readout of which Pushover devices resolve for the CALLER (issue
// #680), backing the line on the /settings "Cook notifications" card.
//
// Its whole job is to turn an INVISIBLE misconfiguration into a visible one at
// exactly the moment someone would go looking. Device names follow
// `<firstname>-<phone|tablet|spare>` and nothing enforces that: a typo at
// registration, or a member renamed in the admin UI, silently stops their timers
// arriving. Without this card the only symptom is "my timers stopped working"
// weeks later.
//
// It deliberately calls the SAME resolvePushoverTargets the sender uses, so the
// screen cannot disagree with what would actually be delivered — including the
// non-production clamp. A settings card that lies is worse than no card.
//
// The credentials never leave the server; the response is device names only,
// which the caller could read off their own phone anyway.
const pushoverAppToken = defineSecret('PUSHOVER_APP_TOKEN');
const pushoverUserKey = defineSecret('PUSHOVER_USER_KEY');
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

export type ListPushoverDevicesResponse =
  // The account answered. `devices` may be empty — that IS the warning state the
  // card renders, and the client must not confuse it with 'unavailable'.
  | { readonly status: 'ok'; readonly devices: readonly string[] }
  // Not provisioned here, suppressed by the non-production clamp, or Pushover
  // could not be reached. The card says so rather than crying misconfiguration.
  | { readonly status: 'unavailable' };

export const listPushoverDevices = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    region: 'europe-west2',
    secrets: [pushoverAppToken, pushoverUserKey, posthogApiKey],
  },
  async (request): Promise<ListPushoverDevicesResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const token = pushoverAppToken.value();
    const user = pushoverUserKey.value();
    if (!token || !user) return { status: 'unavailable' };

    try {
      const targets = await resolvePushoverTargets({ token, user }, request.auth.uid);
      switch (targets.kind) {
        case 'send':
          return { status: 'ok', devices: targets.devices };
        case 'no-devices':
          // Not an error path HERE: the caller opened settings precisely to see
          // this. The dispatch reports it when a timer actually misses.
          return { status: 'ok', devices: [] };
        case 'suppressed':
        case 'unresolved':
          return { status: 'unavailable' };
      }
    } catch (err) {
      // resolvePushoverTargets never throws (Rule 10), so reaching here is
      // genuinely unexpected. Report, and degrade the card rather than the page.
      reportServerError(err);
      return { status: 'unavailable' };
    }
  },
);
