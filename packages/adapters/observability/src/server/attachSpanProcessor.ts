import { trace } from '@opentelemetry/api';
import { aiOtlpSpanProcessor } from './aiOtlpSpanProcessor.js';
import { distributedSpanProcessor } from './distributedSpanProcessor.js';

// ── Attaching OUR span processors to the provider Genkit owns ─────────────────
// Two processors ride the same process-wide OTel provider — the AI-OTLP one
// (#356, ships Genkit's AI spans to PostHog LLM observability) and the
// distributed one (ships EVERY finished span to /i/v1/traces so a CF invocation
// renders as one coherent end-to-end trace). Attaching them is the SAME operation
// with a different processor, so it is written ONCE here (issue #1007) and
// exposed under the two public names the CF entrypoint already calls.
//
// Why an attach step exists at all: enableFirebaseTelemetry() → genkit core does
// `new NodeSDK(config).start()`, which registers the global provider; its
// `getConfig()` discards any caller-supplied span processors, so the only way to
// add ours is to unwrap the registered provider AFTER it starts and call
// `addSpanProcessor`. Call these from the CF entrypoint chained onto the
// enableFirebaseTelemetry() promise (so the provider exists first).
//
// trace.getTracerProvider() returns a ProxyTracerProvider whose getDelegate()
// is the real BasicTracerProvider (OTel 1.x — `addSpanProcessor` exists). We
// feature-detect everything and no-op on any shape we don't recognise, so a
// genkit/OTel version bump (e.g. OTel 2.x dropping addSpanProcessor) degrades to
// "no traces shipped" rather than a crash at module load.
//
// Best-effort, never throws (CLAUDE.md Rule 10). BOTH legs are suppressed under
// the SAME gate:
//  - POSTHOG_API_KEY is absent → nothing to ship (matches initServerObservability).
//  - GENKIT_TELEMETRY_SERVER is set (local `pnpm dev:emulators` / `genkit start`)
//    → keep the Genkit Dev UI as the single local sink and never POST to PostHog
//    from a dev machine (consistent with how runWithExtractedTraceContext is
//    env-gated locally). Opt back in for deliberate local verification by setting
//    SALT_AI_OTLP_LOCAL=1 — the default stays off in dev.
function attach(processor: unknown, provider: unknown): void {
  try {
    if (!process.env['POSTHOG_API_KEY']) return;
    if (process.env['GENKIT_TELEMETRY_SERVER'] && process.env['SALT_AI_OTLP_LOCAL'] !== '1') {
      return;
    }

    const proxy = provider as { getDelegate?: () => unknown };
    const target = (typeof proxy.getDelegate === 'function' ? proxy.getDelegate() : provider) as {
      addSpanProcessor?: (processor: unknown) => void;
    };

    if (typeof target.addSpanProcessor === 'function') {
      target.addSpanProcessor(processor);
    }
  } catch {
    // Never surface a telemetry-wiring failure to the function's startup path.
  }
}

// `provider` is injectable for testing; production calls both with no argument
// and reads the live global provider.

/** Attach the PostHog AI-OTLP span processor to the Genkit-owned provider. */
export function attachAiOtlpSpanProcessor(provider: unknown = trace.getTracerProvider()): void {
  attach(aiOtlpSpanProcessor, provider);
}

/** Attach the PostHog distributed-tracing span processor, alongside the AI one. */
export function attachDistributedSpanProcessor(
  provider: unknown = trace.getTracerProvider(),
): void {
  attach(distributedSpanProcessor, provider);
}
