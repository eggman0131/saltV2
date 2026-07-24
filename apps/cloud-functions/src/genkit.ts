import { genkit, setGenkitRuntimeConfig } from 'genkit';
import { disableOTelRootSpanDetection } from 'genkit/tracing';
import { googleAI } from '@genkit-ai/google-genai';

// Disable Genkit's reflection server when running under the Firebase Functions
// emulator. GENKIT_ENV=dev (set by `pnpm dev:emulators`) makes the genkit()
// constructor start a reflection server on the FIXED port 3100. The functions
// emulator spawns a fresh runtime PROCESS per function, so every worker races to
// bind 3100 — and Genkit's `server.listen(port)` has no 'error' handler, so the
// loser's EADDRINUSE surfaces as an unhandled `uncaughtException` that kills the
// worker (the request then dies with `socket hang up` — e.g. authorRecipe behind
// the recipe "Review changes" sheet). The emulator doesn't need the reflection
// server at all: it's the Dev UI's introspection channel, owned by `pnpm
// dev:genkit`'s own reflection server, and emulator→Dev UI trace export rides the
// telemetry server (GENKIT_TELEMETRY_SERVER → registerGenkitDevTracing), not this.
// `sandboxedRuntime` is Genkit's documented switch for exactly this — it makes the
// reflection server's start() bail before binding. Gated on FUNCTIONS_EMULATOR so
// `dev:genkit` (which needs the reflection server) is untouched, and so the two
// can finally run side-by-side (Task Pilot "Start All"); prod/staging never hit
// this branch (not FUNCTIONS_EMULATOR, and not GENKIT_ENV=dev). Must run before
// the genkit() call below, which is where the reflection server is started.
if (process.env['FUNCTIONS_EMULATOR']) {
  setGenkitRuntimeConfig({ sandboxedRuntime: true });
}

// Genkit's own OpenTelemetry initialisation is intentionally left ENABLED, but
// its ROOT-SPAN DETECTION is disabled in prod so flow spans join the propagated
// trace instead of re-rooting.
//
// Why root-span detection has to go: Genkit tracks flow parentage in its OWN
// AsyncLocalStorage, NOT OpenTelemetry's context. When a flow runs with no
// Genkit parent in that ALS (every top-level flow, and every leaf AI flow the
// triggers call — embedText / arbitrateCanon / generateCanonIcon — since the
// trigger's domain orchestration opens only plain OTel spans, never Genkit
// ones), Genkit marks the span `isRoot` and passes `{ root: true }` to
// `tracer.startSpan`. OTel honours that by DELETING the active span from the
// context, so the flow ignores the browser/request trace we installed via
// runWith{Extracted,Supplied}TraceContext and mints a fresh trace id. That is
// why structural spans (canon.*) nest correctly but the AI sub-flows each split
// off into their own root trace. disableOTelRootSpanDetection() stops Genkit
// from setting `{ root: true }`, so flow spans parent off context.active() like
// any other span — nesting when a trace is propagated, still rooting naturally
// when none is (context.active() is empty → no parent). It only ALLOWS nesting;
// it never forces it. (See genkit core tracing/instrumentation.ts runInNewSpan.)
//
// History: until the PostHog migration we also called
// disableGenkitOTelInitialization() alongside this, to stop Genkit's global
// TracerProvider from racing the LaunchDarkly Observability Node SDK (which
// self-owned a NodeTracerProvider inside the flow body). LaunchDarkly is gone
// now and OTel is owned by enableFirebaseTelemetry()
// (apps/cloud-functions/src/index.ts) — the Genkit-native integration that works
// THROUGH Genkit's OTel pipeline — so disabling Genkit's init would break it and
// stays removed. Only disableOTelRootSpanDetection() returns, because trace
// propagation is no longer dormant (it shipped in #356/#363/#364); the prior
// "propagation is dormant, leave flows flow-rooted" rationale is now stale.
//
// Env-gated on the SAME switch as the propagation helpers
// (runFlowWithTraceContext in index.ts, runTriggerWithTraceContext in the
// triggers): SUPPRESSED under GENKIT_TELEMETRY_SERVER (local
// `pnpm dev:emulators`) so flows stay root-listed in the Genkit Dev UI (whose
// trace list surfaces only flow-rooted traces); honoured in prod/staging so the
// AI sub-flows join the one end-to-end trace. The flag is process-global and
// one-way, but a CF process serves a single deployment environment, so the
// module-load gate is correct. It runs before any flow executes (this module is
// imported by every flow definition).
if (!process.env['GENKIT_TELEMETRY_SERVER']) {
  disableOTelRootSpanDetection();
}

// googleAI() reads GEMINI_API_KEY (or GOOGLE_API_KEY) from process.env at request time.
export const ai = genkit({
  plugins: [googleAI()],
});
