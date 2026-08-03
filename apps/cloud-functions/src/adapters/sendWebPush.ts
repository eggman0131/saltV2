import webpush from 'web-push';

// Bounded, NON-THROWING web-push wrapper (CLAUDE.md Rule 10). The `web-push`
// library POSTs an encrypted payload to the browser's push endpoint and REJECTS
// on any transport/protocol error, carrying the push service's HTTP status on
// `err.statusCode`. This helper collapses every outcome into a small Result so
// the caller (onCookTimerDispatch) never has to try/catch around a send and can
// react to a dead subscription (prune) vs a transient failure (report) without
// the send ever taking down the task.
//
// Deliberately does NOT report inside here: reporting is the caller's decision
// (it has the session/subscription context and the flush lifecycle). This stays
// a pure send-and-classify.
export type WebPushResult = 'sent' | 'gone' | 'failed';

// Is this subscription served by Apple's push service (iOS/macOS Safari, and an
// installed iOS PWA)? The endpoint HOST is the only per-device platform signal we
// hold anywhere: a push subscription is keyed `${uid}_${deviceHash}` and carries
// no platform field, and the Pushover side identifies devices by NAME with no
// platform either (its validate endpoint returns names only, and `licenses` is
// account-level — useless on one shared family account). There is no key that
// could correlate the two registries, which is why routing is decided here, off
// the URL, rather than by pairing a browser subscription to a Pushover device.
//
// Used by onCookTimerDispatch to route Apple devices down web push (APNs wakes
// them reliably) while Android falls to Pushover. It CANNOT separate Chrome on
// Android from Chrome on a desktop — both are FCM — and deliberately does not
// try: the fallback rule that consumes this keeps unmatched devices covered.
export function isApplePushEndpoint(endpoint: string): boolean {
  try {
    const { hostname } = new URL(endpoint);
    return hostname === 'web.push.apple.com' || hostname.endsWith('.push.apple.com');
  } catch {
    // Unparseable endpoint — treat as non-Apple. It will still receive a push
    // whenever Pushover did not deliver, so a malformed URL cannot silence a
    // device that has no other channel.
    return false;
  }
}

interface Vapid {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

interface WebPushSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export async function sendWebPush(
  vapid: Vapid,
  subscription: WebPushSubscription,
  payload: unknown,
): Promise<WebPushResult> {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: vapid.subject,
          publicKey: vapid.publicKey,
          privateKey: vapid.privateKey,
        },
        // One-hour relevance window: a cook-timer notification is worthless long
        // after the timer fired, so tell the push service not to hold it.
        TTL: 3600,
      },
    );
    return 'sent';
  } catch (err) {
    // 404/410 from the push service means the subscription is permanently dead
    // (unsubscribed / endpoint retired) — the caller prunes the doc. Any other
    // status (or a non-HTTP throw) is a transient/unexpected failure the caller
    // reports. Read statusCode defensively — a non-web-push throw won't have it.
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 404 || statusCode === 410) return 'gone';
    return 'failed';
  }
}
