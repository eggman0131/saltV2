import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// Genkit's own OpenTelemetry initialisation is intentionally left ENABLED.
//
// History: until the PostHog migration we called disableGenkitOTelInitialization()
// and disableOTelRootSpanDetection() here. Those existed only to stop Genkit's
// global TracerProvider from racing the LaunchDarkly Observability Node SDK
// (which self-owned a NodeTracerProvider inside the flow body) and to let flow
// spans inherit a propagated browser trace. LaunchDarkly is gone now:
//   • OTel is owned by enableFirebaseTelemetry() (apps/cloud-functions/src/index.ts),
//     which is the Genkit-native telemetry integration — it works THROUGH Genkit's
//     OTel pipeline, not against it, so disabling Genkit's init would break it.
//   • Trace propagation stays DORMANT, so flow spans should remain flow-rooted —
//     which is exactly Genkit's default root-span behaviour, and is what the
//     Genkit Dev UI's trace list needs to surface them.
// Both disables are therefore removed; Genkit collects and exports spans natively
// (to GCP/Firebase Monitoring in prod, to the Dev UI via GENKIT_TELEMETRY_SERVER
// locally — see genkitTracing.ts).

// googleAI() reads GEMINI_API_KEY (or GOOGLE_API_KEY) from process.env at request time.
export const ai = genkit({
  plugins: [googleAI()],
});
