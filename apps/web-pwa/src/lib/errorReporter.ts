import { createObservabilityErrorReportingAdapter } from '@salt/observability';

// The ONE error-reporting adapter for the web-pwa service layer (issue #1053).
//
// This module exists because the boilerplate was the bug. Reporting an error
// used to cost every service a five-line lazy singleton of its own — sixteen
// byte-identical copies of it exist across `src/lib` — and eight files declined
// to pay: twelve subscription onError callbacks reported nothing at all, so
// StorageError and SyncError on appSettings, devSettings, equipment, the
// equipment icons, every meal-plan document, the roster, the shop-day markers
// and the weather cache reached PostHog from nowhere. The policy in
// docs/salt-architecture.md §7.6 says coverage is decided by the error's
// CATEGORY, never by which call site remembered; that was only true at the
// eighteen sites that had paid.
//
// So the cost is paid once, here. A service that wants to report imports this
// and is done. The sixteen private copies are correct today and are deliberately
// NOT swept by #1053 — they collapse onto this module one import line at a time,
// with #933's tranche of shared web-pwa helpers.
//
// Lazy, because constructing the adapter touches PostHog and module-eval order
// in the PWA runs before auth; every existing copy is lazy for the same reason.
let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
export function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}
