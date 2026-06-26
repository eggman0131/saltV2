// Server subpath barrel for @salt/observability/server (posthog-node + native
// OTel via @opentelemetry/api). Mirrors @salt/ld-observability/server's export
// shape so cloud-functions call sites swap with a one-line import change. The
// client singleton, init/guards, capture helpers, flush and span shims live in
// the leaf module src/server/init.ts; the port adapters import from it. This
// barrel is imported by NONE of them — keeping it a dependency-graph leaf so
// there is no cycle (CLAUDE.md Rule 8 / dependency-cruiser no-circular), exactly
// how src/index.ts + src/init.ts are split on the browser side.

export {
  initServerObservability,
  isServerObservabilityInitialised,
  whenServerObservabilityReady,
  flushServerObservability,
  startSpan,
  setActiveSpanName,
  runWithExtractedTraceContext,
  captureServerEvent,
  captureServerException,
  captureAiGeneration,
  safePosthog,
} from './init.js';
export type {
  ObservabilitySpan,
  StartSpanOptions,
  AiGenerationEvent,
  AiGenerationUsage,
} from './init.js';

// cf-path match logger. Exported under both the posthog-specific name and the
// LD-parity alias (createServerObservabilityMatchLoggingAdapter) so call sites
// and tests can repoint by import path alone.
export {
  createPosthogServerMatchLoggingAdapter,
  createPosthogServerMatchLoggingAdapter as createServerObservabilityMatchLoggingAdapter,
} from './posthogServerMatchLoggingAdapter.js';

// Server error reporter (new this phase — no LD equivalent existed).
export {
  createPosthogServerErrorReportingAdapter,
  createPosthogServerErrorReportingAdapter as createServerObservabilityErrorReportingAdapter,
} from './posthogServerErrorReportingAdapter.js';

// Shared slim canon.match wire schema — re-exported for parity with the browser
// barrel and so cf-side tests can assert against the single source of truth.
export { CANON_MATCH_EVENT, toCanonMatchEvent } from '../shared/matchOutcomeEvent.js';
export type { CanonMatchEventProps, CanonMatchPath } from '../shared/matchOutcomeEvent.js';
