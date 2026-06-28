import { trace } from '@opentelemetry/api';
import { distributedSpanProcessor } from './distributedSpanProcessor.js';

// Attach the PostHog distributed-tracing span processor to the process-wide OTel
// provider that Genkit owns — ALONGSIDE the AI-OTLP processor (see
// attachAiOtlpProcessor.ts). enableFirebaseTelemetry() → genkit core does
// `new NodeSDK(config).start()`, which registers the global provider; its
// `getConfig()` discards any caller-supplied span processors, so the only way to
// add ours is to unwrap the registered provider AFTER it starts and call
// `addSpanProcessor`. Call this from the CF entrypoint chained onto the
// enableFirebaseTelemetry() promise (so the provider exists first), right next to
// attachAiOtlpSpanProcessor().
//
// trace.getTracerProvider() returns a ProxyTracerProvider whose getDelegate()
// is the real BasicTracerProvider (OTel 1.x — `addSpanProcessor` exists). We
// feature-detect everything and no-op on any shape we don't recognise, so a
// genkit/OTel version bump (e.g. OTel 2.x dropping addSpanProcessor) degrades to
// "no distributed traces shipped" rather than a crash at module load.
//
// Best-effort, never throws (CLAUDE.md Rule 10). Suppressed under the SAME gate
// as the AI processor:
//  - POSTHOG_API_KEY is absent → nothing to ship (matches initServerObservability).
//  - GENKIT_TELEMETRY_SERVER is set (local `pnpm dev:emulators` / `genkit start`)
//    → keep the Genkit Dev UI as the single local sink and never POST to PostHog
//    from a dev machine. Opt back in for deliberate local verification by setting
//    SALT_AI_OTLP_LOCAL=1 — the default stays off in dev.
//
// `provider` is injectable for testing; production calls it with no argument and
// reads the live global provider.
export function attachDistributedSpanProcessor(
  provider: unknown = trace.getTracerProvider(),
): void {
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
      target.addSpanProcessor(distributedSpanProcessor);
    }
  } catch {
    // Never surface a telemetry-wiring failure to the function's startup path.
  }
}
