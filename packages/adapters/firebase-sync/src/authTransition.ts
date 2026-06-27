// Auth-transition flag for the sign-out / token-refresh teardown race.
//
// When the user signs out (or a token refresh tears down in-flight listeners),
// Firestore listeners that were still attached fire a `permission-denied` error
// as the security rules stop matching the now-signed-out user. That maps to
// `AuthError` (firestoreErrors.ts / toAuthError) — which is reportable BY
// CATEGORY ("report the unexpected") — but it is an EXPECTED teardown artefact,
// not a real failure, so it must be suppressed.
//
// A genuine rules-misconfig `permission-denied` (with NO transition in flight)
// must still be reported. So the suppression cannot live in isReportableCategory
// (that would silence every AuthError); it is this in-flight flag instead. Both
// the auth catch sites AND the listener/service onError sites consult it before
// reporting an AuthError.
//
// Module-level boolean (single Auth per app); deliberately not keyed to an Auth
// instance — the race window is short and a stale-true is harmless (it only ever
// suppresses an AuthError that is, by construction, the teardown race).
let authTransitioning = false;

export function setAuthTransitioning(value: boolean): void {
  authTransitioning = value;
}

export function isAuthTransitioning(): boolean {
  return authTransitioning;
}
