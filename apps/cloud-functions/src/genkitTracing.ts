import { setTelemetryServerUrl } from 'genkit/tracing';

// Route Genkit flow traces to the local Genkit Dev UI when GENKIT_TELEMETRY_SERVER
// is set (i.e. during `pnpm dev:emulators`).
//
// Re-homed for the PostHog migration. Previously this attached a manual
// BatchSpanProcessor(TraceServerExporter) to the LaunchDarkly-owned
// NodeTracerProvider via addServerSpanProcessor() — that workaround was only
// needed because disableGenkitOTelInitialization() had turned OFF Genkit's
// native span export so spans could be routed through LD's provider instead.
//
// With LD gone, Genkit's own OTel pipeline is enabled again (see genkit.ts), so
// Genkit exports its spans to the telemetry server natively. Pointing it at the
// dev server URL is all that's required — no provider, no manual span processor.
// This path does NOT depend on any self-owned NodeTracerProvider; OTel for
// production is owned by enableFirebaseTelemetry() in index.ts.
export function registerGenkitDevTracing(): void {
  const genkitUrl = process.env['GENKIT_TELEMETRY_SERVER'];
  if (!genkitUrl) return;
  setTelemetryServerUrl(genkitUrl);
}
