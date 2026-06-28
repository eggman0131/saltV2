import { runWithSuppliedTraceContext } from '@salt/observability/server';

// ─── Firestore-trigger trace continuity (issue #362, Phase 5) ──────────────────
//
// Firestore triggers have NO inbound W3C trace HTTP header to extract from (the
// callable path's primary source). Instead the browser/upstream trigger stamps a
// W3C `traceparent` onto the written doc as a `traceContext` correlation field;
// each trigger reads it and runs its work within that context so the trigger's
// spans nest under the SAME browser-rooted trace ("Add to shopping list" → the
// canon-match trigger → the icon trigger) instead of re-rooting.
//
// This wraps `runWithSuppliedTraceContext` (the field-channel helper in
// @salt/observability/server) with the SAME env-gate the callable path applies in
// runFlowWithTraceContext (index.ts): the gate lives caller-side — neither
// runWithSuppliedTraceContext nor runWithExtractedTraceContext gate internally —
// so the trigger path replicates it here. Centralised so both triggers share one
// gate rather than each inlining the env check.
//
// Env-gate: SUPPRESSED when GENKIT_TELEMETRY_SERVER is set (local
// `pnpm dev:emulators`) so flows stay root-listed in the Genkit Dev UI — the same
// gate that resolved the 2026-05-11 propagation regression. In production (unset)
// the supplied context is honoured. An absent/malformed traceContext degrades to
// a plain call and never throws (Rule 10) — a bad id costs at most a split trace,
// never a failed trigger.
export function runTriggerWithTraceContext<T>(traceContext: string | undefined, fn: () => T): T {
  // Local dev: suppress propagation so trigger flows stay root-listed in the Dev UI.
  if (process.env['GENKIT_TELEMETRY_SERVER']) {
    return fn();
  }
  // Production: continue the browser-rooted trace carried by the doc field.
  // Degrades safely when traceContext is absent/malformed.
  return runWithSuppliedTraceContext(traceContext, fn);
}
