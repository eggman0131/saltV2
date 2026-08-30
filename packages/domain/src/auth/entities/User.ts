// Auth entity: an authenticated user identity surfaced by the AuthProvider.
//
// HAND-WRITTEN ON PURPOSE, and one of only three left in the domain (issue
// #932). This is a Firebase Auth user, never a Firestore document: it has no
// schema to derive from because nothing ever parses it off the wire. Do not
// "complete" the schema-first sweep by inventing a schema for it.
// Workspace role is intentionally NOT on User — workspace membership lives in
// its own module and joins to a uid. Auth answers "who is signed in?" only.
export interface User {
  readonly uid: string;
  readonly email: string | null;
}
