import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { memberFirstName, normaliseMemberEmail } from '@salt/domain';
import { MemberSchema } from '@salt/domain/schemas';
import { resolveServerEnvironment } from '../observability/environment.js';
import { resolvePushoverDevices, type PushoverCredentials } from './sendPushover.js';

// Works out WHICH Pushover devices a given uid may be sent to (issue #680).
// Shared by the cook-timer dispatch and by the /settings readout so the screen
// tells the truth about what would actually be delivered — a settings card that
// disagrees with the sender is worse than no card at all.
//
// Everything here already exists in the data model; no schema change was needed.
// The one hop is uid → email → member: cook sessions carry an `ownerUid`, but
// members are keyed by normalised email, and the device naming convention keys
// off the member's `name`.
//
// Never throws (CLAUDE.md Rule 10): every outcome is a variant of PushoverTargets.

// In NON-PRODUCTION, only this member's devices may be targeted. Staging and dev
// run against the SAME shared family Pushover account (the user key IS the
// account, so a second application token would still reach the same handsets),
// and a staging cook-timer test must not wake four other people at 11pm.
const NON_PROD_DEVICE_OWNER = 'daniel';

// Same rationale as the device-list cache in sendPushover: a member's first name
// is looked up on a latency-sensitive path and changes about never. Cache, not
// state — recycling an instance just costs one more read.
const MEMBER_CACHE_TTL_MS = 5 * 60_000;

export type PushoverTargets =
  // Send to exactly these device names. Never empty.
  | { readonly kind: 'send'; readonly devices: readonly string[] }
  // Non-production, and this member is not the test-device owner. Expected, and
  // deliberately NOT reported.
  | { readonly kind: 'suppressed' }
  // Could not reach Pushover, or could not read the member. Operational blip —
  // the caller logs; a retry may well work.
  | { readonly kind: 'unresolved'; readonly reason: string }
  // The account answered and NOTHING matched `<firstname>-`. This is a
  // MISCONFIGURATION (a mistyped device name, or a member renamed in the admin
  // UI), not a blip, and the caller reports it (§7.6). Silence here is exactly
  // what would let one person's timers vanish for weeks.
  | { readonly kind: 'no-devices'; readonly firstName: string };

const memberCache = new Map<string, { readonly firstName: string; readonly fetchedAt: number }>();

// Test seam only — module memory would otherwise leak between cases.
export function __resetPushoverMemberCache(): void {
  memberCache.clear();
}

// uid → the member's first name, cached. Returns null when the uid has no email,
// no roster doc, or the read fails — all of which the caller treats as
// 'unresolved' rather than guessing at a device name.
async function memberFirstNameForUid(uid: string): Promise<string | null> {
  const cached = memberCache.get(uid);
  if (cached && Date.now() - cached.fetchedAt < MEMBER_CACHE_TTL_MS) return cached.firstName;

  try {
    const { email } = await getAuth().getUser(uid);
    if (!email) {
      logger.error('pushover: uid has no email', { uid });
      return null;
    }
    const snap = await getFirestore().collection('members').doc(normaliseMemberEmail(email)).get();
    if (!snap.exists) {
      logger.error('pushover: no member doc for uid', { uid });
      return null;
    }
    const parsed = MemberSchema.safeParse(snap.data());
    if (!parsed.success) {
      logger.error('pushover: invalid member doc', { uid, error: parsed.error.message });
      return null;
    }

    const firstName = memberFirstName(parsed.data.name);
    memberCache.set(uid, { firstName, fetchedAt: Date.now() });
    return firstName;
  } catch (err) {
    logger.error('pushover: member lookup failed', { uid, err });
    return null;
  }
}

export async function resolvePushoverTargets(
  creds: PushoverCredentials,
  uid: string,
): Promise<PushoverTargets> {
  // The emulator never sends, full stop — not even to the test-device owner.
  // e2e seeds a member called Daniel and fires cook timers on every CI run, so
  // without this a populated .secret.local would turn the test suite into a
  // pager. resolveServerEnvironment() collapses the emulator into 'development'
  // and so cannot make this distinction; the raw flag can.
  if (process.env['FUNCTIONS_EMULATOR'] === 'true') return { kind: 'suppressed' };

  const firstName = await memberFirstNameForUid(uid);
  if (firstName === null) return { kind: 'unresolved', reason: 'member lookup failed' };

  if (
    resolveServerEnvironment() !== 'production' &&
    firstName.toLowerCase() !== NON_PROD_DEVICE_OWNER
  ) {
    return { kind: 'suppressed' };
  }

  const devices = await resolvePushoverDevices(creds, firstName);
  // null = could not reach the account (blip); [] = reached it and nothing
  // matched (misconfiguration). Collapsing the two would either spam reports on
  // every network wobble or hide a member whose devices stopped matching.
  if (devices === null) return { kind: 'unresolved', reason: 'device resolution failed' };
  if (devices.length === 0) return { kind: 'no-devices', firstName };

  return { kind: 'send', devices };
}
