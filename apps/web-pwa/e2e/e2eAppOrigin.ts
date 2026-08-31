/**
 * The e2e app server's host/port, in exactly one place (#1142 review, finding 1).
 *
 * Before this file the port lived as four independent literal copies —
 * `globalSetup.ts` (spawns Vite here), `playwright.config.ts` (`baseURL`),
 * `scripts/process-e2e-coverage.ts` (the `APP_ORIGIN` filter) and
 * `tests/e2eCoverageReport.test.ts` (its own `APP_ORIGIN`) — that could drift
 * silently: change the port in three of the four and every gate (`test`,
 * `typecheck`) stays green while `e2e:coverage` quietly filters out every real
 * entry and ships an empty `lcov.info`. Every consumer now imports from here
 * instead of repeating the number, so a port move is one edit, not four.
 *
 * `scripts/process-e2e-coverage.ts` runs as `node --experimental-strip-types`
 * directly (no bundler), which requires the literal `.ts` extension on
 * relative specifiers — hence `allowImportingTsExtensions` in
 * `tsconfig.test.json`. Every other consumer here is loaded through
 * Playwright's own TS transform and imports this file extension-less.
 */
export const E2E_APP_HOST = '127.0.0.1';
export const E2E_APP_PORT = 5174;
export const E2E_APP_ORIGIN = `http://${E2E_APP_HOST}:${E2E_APP_PORT}`;
