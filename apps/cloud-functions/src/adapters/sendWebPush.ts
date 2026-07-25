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
