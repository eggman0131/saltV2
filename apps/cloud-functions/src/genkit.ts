import { genkit } from 'genkit';
import { disableGenkitOTelInitialization, disableOTelRootSpanDetection } from 'genkit/tracing';
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

// By default, Genkit's runInNewSpan passes { root: true } to OTel when no
// Genkit-internal parent step exists, which makes flow spans IGNORE the
// active OTel context — they start a fresh trace even when the callable
// entrypoint installs the propagated browser trace via context.with().
// This opt-out tells Genkit to leave OTel's default root-detection in
// place, so flow spans inherit context.active() like every other span.
// Same "subject to breaking changes" caveat as the line above.
disableOTelRootSpanDetection();

// googleAI() reads GEMINI_API_KEY (or GOOGLE_API_KEY) from process.env at request time.
export const ai = genkit({
  plugins: [googleAI()],
});
