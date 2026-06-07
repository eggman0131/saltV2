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
export interface Member {
  readonly id: string; // = normalised email; also the Firestore doc key
  readonly schemaVersion: 1;
  readonly name: string;
  readonly email: string; // normalised (trimmed, lowercased)
  readonly admin: boolean;
  readonly sortOrder: number;
  // Reserved for richer avatars later (#155 ships initials only). null = render
  // initials derived from `name`. No image upload/generation in this module.
  readonly icon: string | null;
  readonly updatedAt: string; // ISO-8601, stamped by domain commands on mutation
}
