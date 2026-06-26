// Pure re-export barrel. Mirrors @salt/ld-observability's layout: the client
// singleton, init, guards, identify/track helpers and span shims live in the
// leaf module src/init.ts, which the adapters and session modules import from.
// This file is imported by NONE of them — keeping it a dependency-graph leaf so
// there is no cycle (CLAUDE.md Rule 8 / dependency-cruiser no-circular).
export {
  initObservability,
  isObservabilityReady,
  safePosthog,
  identifyObservabilityUser,
  identifyObservabilityAnonymous,
  trackObservabilityEvent,
  startSpan,
  extractTraceHeaders,
} from './init.js';
export type { ObservabilityOptions, ObservabilitySpan } from './init.js';
export {
  createPosthogMatchLoggingAdapter as createObservabilityMatchLoggingAdapter,
  createPosthogMatchLoggingAdapter,
} from './posthogMatchLoggingAdapter.js';
export {
  createPosthogErrorReportingAdapter as createObservabilityErrorReportingAdapter,
  createPosthogErrorReportingAdapter,
} from './posthogErrorReportingAdapter.js';
export { tagObservabilitySession, getObservabilitySessionURL } from './sessionTagging.js';
export type { ObservabilitySessionMeta } from './sessionTagging.js';
export {
  startObservabilitySession,
  stopObservabilitySession,
  isObservabilitySessionActive,
} from './sessionControl.js';
export { CANON_MATCH_EVENT } from './shared/matchOutcomeEvent.js';
export type { CanonMatchEventProps, CanonMatchPath } from './shared/matchOutcomeEvent.js';
