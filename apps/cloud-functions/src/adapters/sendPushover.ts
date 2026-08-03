// Bounded, NON-THROWING Pushover wrapper (CLAUDE.md Rule 10), the sibling of
// sendWebPush.ts. Cook timers are the one notification in Salt that is worthless
// if late, and Chrome web push does not reliably wake a dozing Android device
// (issue #680). Pushover's native client gets the high-priority FCM wake that
// Chrome's push path doesn't, so this changes the delivery physics rather than
// adding a hop that terminates in the same dozing browser.
//
// Two calls make up the flow, and the ORDER is the whole point:
//   1. resolvePushoverDevices — POST /1/users/validate.json returns the account's
//      live device names; we keep only those matching a member's `<firstname>-`
//      prefix.
//   2. sendPushover — POST /1/messages.json to those exact names.
//
// THE TRAP THIS DEFENDS AGAINST. Pushover FAILS OPEN: a `device` naming a device
// that is not valid is broadcast to ALL active devices on the account rather than
// erroring, deliberately, "to avoid losing messages". Because this is ONE SHARED
// family account, that is exactly the wrong way round for us — a typo at device
// registration, or a member renamed in the admin UI, would not mean one person
// misses a timer, it would mean the WHOLE FAMILY gets pinged for one person's
// rice, silently, every time. So callers must resolve first, send only to names
// confirmed to exist, and send NOTHING on a zero-match. A zero-match is a
// misconfiguration, not an operational blip: the caller reports it (§7.6), which
// is what stops it hiding for weeks.
//
// Deliberately does NOT report in here — reporting is the caller's decision (it
// holds the session context and the flush lifecycle), exactly as in sendWebPush.
import { logger } from 'firebase-functions';

const VALIDATE_URL = 'https://api.pushover.net/1/users/validate.json';
const MESSAGES_URL = 'https://api.pushover.net/1/messages.json';

// A timer dispatch is latency-sensitive and already inside a Cloud Task with its
// own retry policy, so fail fast rather than hold the invocation open.
const REQUEST_TIMEOUT_MS = 5_000;

// The device list almost never changes, and resolving it is an extra round trip
// on the critical path. Module memory is a CACHE, not state — instance recycling
// just costs one more validate call, so there is nothing to keep consistent.
const DEVICE_CACHE_TTL_MS = 5 * 60_000;

export interface PushoverCredentials {
  readonly token: string;
  readonly user: string;
}

export type PushoverSendResult = 'sent' | 'failed';

// `null` means "could not resolve" (transport/API failure) — distinct from `[]`,
// which means "the account answered, and nothing matched the prefix". The caller
// must treat the two differently: the first is a blip, the second is a
// misconfiguration worth reporting.
export type PushoverDeviceResolution = readonly string[] | null;

let deviceCache: { readonly devices: readonly string[]; readonly fetchedAt: number } | null = null;

// Test seam only — the module-memory cache would otherwise leak between cases.
export function __resetPushoverDeviceCache(): void {
  deviceCache = null;
}

// Bounded POST of form-encoded params. Pushover's API is form-encoded, returns
// JSON, and signals failure with a non-2xx plus `status: 0`. Never throws.
async function postForm(url: string, params: Record<string, string>): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Read the body before branching on ok: Pushover puts its `errors` array in
    // the body of a 4xx, and that is the only useful diagnostic.
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      logger.error('pushover: request rejected', {
        url,
        status: response.status,
        // `errors` is Pushover's own array of strings about the REQUEST shape
        // (bad token, unknown device). It carries no user content.
        errors: (body as { errors?: unknown } | null)?.errors,
      });
      return null;
    }
    return body;
  } catch (err) {
    // Transport failure or the 5s timeout. No user content in the log.
    logger.error('pushover: request failed', { url, err });
    return null;
  }
}

// Fetch the account's live device names, cached with a short TTL. Returns null
// when the account could not be reached — callers must not treat that as "no
// devices" (see PushoverDeviceResolution).
async function fetchAccountDevices(creds: PushoverCredentials): Promise<readonly string[] | null> {
  const now = Date.now();
  if (deviceCache && now - deviceCache.fetchedAt < DEVICE_CACHE_TTL_MS) {
    return deviceCache.devices;
  }

  const body = await postForm(VALIDATE_URL, { token: creds.token, user: creds.user });
  if (!body) return null;

  // Shape-check rather than trust: this is a trust boundary, and a `devices` that
  // is not an array of strings must not silently become a send target.
  const devices = (body as { devices?: unknown }).devices;
  if (!Array.isArray(devices) || devices.some((d) => typeof d !== 'string')) {
    logger.error('pushover: validate returned an unexpected devices shape');
    return null;
  }

  const named = devices as readonly string[];
  deviceCache = { devices: named, fetchedAt: now };
  return named;
}

// Resolve the devices belonging to one member. Device names follow
// `<firstname>-<phone|tablet|spare>`, so a member's devices are those whose name
// starts with their lowercased first name plus a hyphen. The convention earns its
// keep over a hardcoded list: someone gets a new phone, names it `daniel-phone`
// in the Pushover app, and it works with no config change anywhere.
//
// The prefix match is on `${firstName}-` specifically, NOT a bare `startsWith`:
// otherwise `dan-phone` would capture `daniel-phone`, and a member called `Dan`
// would quietly steal `Daniel`'s timers.
export async function resolvePushoverDevices(
  creds: PushoverCredentials,
  firstName: string,
): Promise<PushoverDeviceResolution> {
  const prefix = `${firstName.trim().toLowerCase()}-`;
  // An empty first name yields the prefix '-', which would match nothing anyway,
  // but bail explicitly so the caller's zero-match report names the real cause.
  if (prefix === '-') return [];

  const devices = await fetchAccountDevices(creds);
  if (!devices) return null;

  return devices.filter((name) => name.toLowerCase().startsWith(prefix));
}

// Send one message to an EXPLICIT list of device names — never to the account at
// large. Callers must pass names that resolvePushoverDevices confirmed exist; an
// empty list is refused here as a second line of defence against the fail-open
// broadcast described at the top of this file.
export async function sendPushover(
  creds: PushoverCredentials,
  devices: readonly string[],
  message: { readonly title: string; readonly body: string },
): Promise<PushoverSendResult> {
  if (devices.length === 0) return 'failed';

  const body = await postForm(MESSAGES_URL, {
    token: creds.token,
    user: creds.user,
    title: message.title,
    message: message.body,
    // Pushover takes multiple devices as one comma-separated value, so the whole
    // family fan-out for a member is a single round trip.
    device: devices.join(','),
    // Priority 1 (high), not 2 (emergency). High always plays a sound and
    // vibrates and bypasses the user's quiet hours, which is right for a timer.
    // Emergency repeats until acknowledged — overkill here, and it would be
    // resented; it stays reserved for something genuinely destructive.
    priority: '1',
  });

  return body ? 'sent' : 'failed';
}
