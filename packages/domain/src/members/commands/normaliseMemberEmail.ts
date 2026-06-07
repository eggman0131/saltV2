// Canonical email normalisation for members (issue #155).
//
// The normalised form is the member's Firestore doc key AND must match the
// Firebase Auth ID-token `email` claim so the security rules can resolve the
// caller's own doc. Keep this in lock-step with the web login boundary (which
// lowercases before sendSignInLinkToEmail) and the beforeUserCreated blocking
// function (which lowercases the incoming email before the allowlist lookup).
export function normaliseMemberEmail(email: string): string {
  return email.trim().toLowerCase();
}
