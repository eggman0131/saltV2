import { genkit } from 'genkit';
import { disableGenkitOTelInitialization } from 'genkit/tracing';
import { googleAI } from '@genkit-ai/google-genai';

// Genkit lazy-initialises its own OpenTelemetry NodeSDK on first flow
// invocation. That setGlobalTracerProvider call wins the race against the
// LaunchDarkly Observability Node SDK (which initialises later, inside the
// flow body), so LD's TracerProvider gets rejected as a duplicate and our
// CF spans never reach LD's OTLP endpoint. Disabling Genkit's OTel keeps
// the global free for LD to claim.
//
// This is an internal Genkit API marked "subject to breaking changes" — if
// it disappears in a future Genkit version, we'll need to invert the order:
// initialise LD first (at module load), then let Genkit attempt second.
disableGenkitOTelInitialization();

// googleAI() reads GEMINI_API_KEY (or GOOGLE_API_KEY) from process.env at request time.
export const ai = genkit({
  plugins: [googleAI()],
});
