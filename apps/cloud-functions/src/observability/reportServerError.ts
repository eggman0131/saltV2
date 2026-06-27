import type { DomainError } from '@salt/shared-types';
import {
  createServerObservabilityErrorReportingAdapter,
  flushServerObservability,
} from '@salt/observability/server';

// Single server-side error-reporting entrypoint for cloud-functions, mirroring
// the web-pwa `getErrorReporter()` singleton pattern. The adapter is created once
// at module load and reused across invocations so every CF catch site routes
// through the SAME category-gated, never-throwing port (CLAUDE.md Rule 10,
// §Observability). Sourced from @salt/observability/server ONLY — never the
// default subpath, which wraps the browser-only PostHog SDK (CLAUDE.md Rule 5).
//
// Reporting is ADDITIVE: every existing firebase-functions/logger call stays.
// This sends the same failure to PostHog error tracking so server exceptions
// surface alongside browser-side ones under the synthetic server person.
const reporter = createServerObservabilityErrorReportingAdapter();

// Report a caught server error, best-effort. `category` is optional: server
// failures are usually RAW uncategorised exceptions (there is no server
// classifyFirestoreError), so omitting it gates as reportable ("report the
// unexpected"). Pass a DomainError kind when one is genuinely known (e.g. a
// classified Result envelope) so a suppressed category is honoured exactly like
// the client. Never throws — the adapter swallows any SDK failure.
export function reportServerError(error: unknown, category?: DomainError['kind']): void {
  reporter.report(error, category);
}

// Report a caught error and flush before the function freezes, best-effort. Use
// inside a flow / callable catch when the surrounding code does NOT already flush
// in a finally (posthog-node batches; an un-flushed event is lost when the Node
// process is paused between invocations). flush is non-throwing and no-ops when
// uninitialised, so this is always safe to call. Never throws.
//
// This is the AI/Genkit flow-failure reporting hook: a flow throwing (incl.
// AiTimeoutError from withAiTimeout) calls this in its catch, then re-throws so
// the flow's failure behaviour and the onCallGenkit/onCall error path are
// unchanged. Reporting at the flow body (vs wrapping the handler) keeps the
// handler's exact `ai.defineFlow` type inference intact.
export async function reportFlowError(
  error: unknown,
  category?: DomainError['kind'],
): Promise<void> {
  reportServerError(error, category);
  await flushServerObservability();
}
