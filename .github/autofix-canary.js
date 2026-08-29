// Canary for the salt-autofix GitHub App installation (see the autofix.yml
// header). Deliberately mis-formatted: double quotes, no semicolons, 4-space
// indent and a missing trailing comma all violate .prettierrc, so `pnpm
// format:check` fails on this file until autofix.yml pushes the fix back.
//
// It lives under .github/ so ci.yml's non-app allowlist skips the emulator and
// Playwright suites — the point is to exercise autofix's App-token push, not
// to re-run the app's test suite.
//
// DELETE THIS FILE once the token push is observed.
export const AUTOFIX_CANARY = {
  installedApp: 'salt-autofix',
  checks: ['mints an installation token', 'pushes to the PR head'],
};
