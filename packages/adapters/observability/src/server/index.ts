// Server subpath barrel for @salt/observability/server (posthog-node + native
// OTel via @opentelemetry/api). The client singleton, init/guards, capture
// helpers, flush and span shims live in the leaf module src/server/init.ts; the
// port adapters import from it. This barrel is imported by NONE of them —
// keeping it a dependency-graph leaf so there is no cycle (CLAUDE.md Rule 8 /
// dependency-cruiser no-circular), exactly how src/index.ts + src/init.ts are
// split on the browser side.

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
  safePosthog,
} from './init.js';
export type { ObservabilitySpan, StartSpanOptions } from './init.js';

// AI-OTLP span processor: attached to the Genkit-owned OTel provider by the CF
// entrypoint after enableFirebaseTelemetry() resolves; ships Genkit's AI spans
// to PostHog LLM observability as real traces (#356).
export { attachAiOtlpSpanProcessor } from './attachAiOtlpProcessor.js';

// Distributed-tracing span processor: attached ALONGSIDE the AI processor on the
// same Genkit-owned provider; ships EVERY finished span to PostHog's
// distributed-tracing endpoint (/i/v1/traces) so a CF invocation renders as one
// coherent end-to-end trace correlated by trace_id to the AI generations.
export { attachDistributedSpanProcessor } from './attachDistributedProcessor.js';

// cf-path match logger. Exported under both the posthog-specific name and a
// runtime-neutral alias (createServerObservabilityMatchLoggingAdapter) so call
// sites and tests can repoint by import path alone.
export {
  createPosthogServerMatchLoggingAdapter,
  createPosthogServerMatchLoggingAdapter as createServerObservabilityMatchLoggingAdapter,
} from './posthogServerMatchLoggingAdapter.js';

// Server error reporter.
export {
  createPosthogServerErrorReportingAdapter,
  createPosthogServerErrorReportingAdapter as createServerObservabilityErrorReportingAdapter,
} from './posthogServerErrorReportingAdapter.js';

// Shared slim canon.match wire schema — re-exported for parity with the browser
// barrel and so cf-side tests can assert against the single source of truth.
export { CANON_MATCH_EVENT, toCanonMatchEvent } from '../shared/matchOutcomeEvent.js';
export type { CanonMatchEventProps, CanonMatchPath } from '../shared/matchOutcomeEvent.js';

// Same category-gated reporting predicate the browser barrel exports — shared so
// the server adapter (Phase 3) reuses the single source of truth, not a copy.
export { isReportableCategory } from '../shared/reportableCategory.js';
