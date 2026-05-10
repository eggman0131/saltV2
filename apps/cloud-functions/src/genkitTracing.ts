import { BatchSpanProcessor, type ReadableSpan } from '@opentelemetry/sdk-trace-node';
import { SPAN_TYPE_ATTR, TraceServerExporter, setTelemetryServerUrl } from 'genkit/tracing';
import { addServerSpanProcessor } from '@salt/ld-observability/server';

// Register the Genkit dev-trace routing processor so that spans tagged by
// Genkit (SPAN_TYPE_ATTR) are forwarded to the local Genkit Admin UI when
// GENKIT_TELEMETRY_SERVER is set (i.e. during `pnpm dev:emulators`).
//
// This lives here — next to disableGenkitOTelInitialization() in genkit.ts —
// so both halves of the LD ↔ Genkit OTel registration dance are co-located
// in CF land. Call this after initServerObservability() to ensure the
// provider exists before the processor is attached.
export function registerGenkitDevTracing(): void {
  const genkitUrl = process.env['GENKIT_TELEMETRY_SERVER'];
  if (!genkitUrl) return;

  setTelemetryServerUrl(genkitUrl);
  const genkitBatch = new BatchSpanProcessor(new TraceServerExporter());
  addServerSpanProcessor({
    onStart(): void {},
    onEnd(span: ReadableSpan): void {
      if (span.attributes[SPAN_TYPE_ATTR] !== undefined) {
        genkitBatch.onEnd(span);
      }
    },
    forceFlush(): Promise<void> {
      return genkitBatch.forceFlush();
    },
    shutdown(): Promise<void> {
      return genkitBatch.shutdown();
    },
  });
}
