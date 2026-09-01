// Push-subscription identity (issue #1145, carved out of #938's A2-011 twin).
// One document per user per device at `pushSubscriptions/{uid}_{deviceHash}` —
// see schemas/pushSubscription.ts for the full doc contract and why this is one
// of the four sanctioned owner-scoped collections.
//
// COLLISION SAFETY. `deviceHash` is a lowercase-hex SHA-256 prefix (no
// underscore), and a uid is alphanumeric, so the underscore separator is
// unambiguous either side.
const SEPARATOR = '_';

/** The `pushSubscriptions` document id for `uid`'s device `deviceHash`. */
export function pushSubscriptionId(uid: string, deviceHash: string): string {
  return `${uid}${SEPARATOR}${deviceHash}`;
}
