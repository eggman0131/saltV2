// Auth entity: an authenticated user identity surfaced by the AuthProvider.
// Workspace role is intentionally NOT on User — workspace membership lives in
// its own module and joins to a uid. Auth answers "who is signed in?" only.
export interface User {
  readonly uid: string;
  readonly email: string | null;
}
