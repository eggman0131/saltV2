import type { MemberDoc, CookMode } from '../../schemas/member.js';

// Member entity: a person on the Salt allowlist (issue #155).
// Lives in members/entities — internal to the members module. Other modules
// access it only via the published index (re-exported as a type).
//
// `id` is the normalised email and doubles as the Firestore document key. That
// is deliberate: it lets the Firestore security rules resolve the calling
// user's own member doc with `get(/members/$(request.auth.token.email))` to
// read their `admin` flag, without a query. Email is normalised (trimmed,
// lowercased) at every write boundary so the Auth token's email claim matches
// the key (see normaliseMemberEmail).
//
// `cookMode` is the ONLY field a non-admin may change about themselves — see
// firestore.rules, where every other field is pinned on a self-update precisely
// because `admin` is one of them.
//
// Schema-first (issue #417, carried here by issue #932): the file already
// imported `CookMode` from the schema, so this completes it.
export type Member = MemberDoc;
