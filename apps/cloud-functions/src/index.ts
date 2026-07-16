import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { onCall, onCallGenkit, isSignedIn, HttpsError } from 'firebase-functions/https';
import {
  MatchOrCreateCanonWireInputSchema,
  CanonicaliseRecipeIngredientsWireInputSchema,
  AuthorRecipeWireInputSchema,
  DescribeRecipeSceneWireInputSchema,
  ExtractRecipeFromUrlWireInputSchema,
  IdentifyEquipmentWireInputSchema,
  PopulateEquipmentEntryWireInputSchema,
  RefreshWeatherForecastWireInputSchema,
} from '@salt/domain/schemas';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import {
  initServerObservability,
  attachAiOtlpSpanProcessor,
  attachDistributedSpanProcessor,
} from '@salt/observability/server';
import { makeTracedCallable, APP_CHECK_ENFORCEMENT } from './tracedCallable.js';
import { runRefreshWeatherForecast } from './weather/refreshWeatherForecast.js';
import { registerGenkitDevTracing } from './genkitTracing.js';
import { reportFlowError } from './observability/reportServerError.js';
import { resolveServerEnvironment } from './observability/environment.js';
import { armCfTelemetry } from './observability/telemetryReady.js';
import { embedTextFlow } from './flows/embedText.js';
import { arbitrateCanonFlow } from './flows/arbitrateCanon.js';
import { matchOrCreateCanonFlow } from './flows/matchOrCreateCanon.js';
import { canonicaliseRecipeIngredientsFlow } from './flows/canonicaliseRecipeIngredients.js';
import { identifyEquipmentFlow } from './flows/identifyEquipment.js';
import { populateEquipmentEntryFlow } from './flows/populateEquipmentEntry.js';
import { parseRecipeIngredientsFlow } from './flows/parseRecipeIngredients.js';
import { chefChatFlow } from './flows/chefChat.js';
import { authorRecipeFlow } from './flows/authorRecipe.js';
import { describeRecipeSceneFlow } from './flows/describeRecipeScene.js';
import {
  extractRecipeFromUrlFlow,
  UrlImportError,
  type UrlImportFailureCode,
} from './flows/extractRecipeFromUrl.js';
import { generateChatTitleFlow } from './flows/generateChatTitle.js';
import { onShoppingListItemWrite } from './triggers/onShoppingListItemWrite.js';
import { onCanonItemWritten } from './triggers/onCanonItemWritten.js';
import { onRecipeWritten } from './triggers/onRecipeWritten.js';
import { handleListAiModels } from './ai/listAiModels.js';
import { handleTestModel } from './ai/testModel.js';

initializeApp();

// 512MiB is the memory floor for every function. The 256MiB default sits just
// below this codebase's resting footprint — firebase-admin, Genkit/OTel
// (enableFirebaseTelemetry), and posthog-node all load at module init — so a
// function OOMs on its first real context read (chefChat died at "263 MiB used",
// 7 over). Override UPWARD per function where proven (onCanonItemWritten's icon
// decode needs 1GiB).
//
// NB: firebase-functions bakes global options into each function's __endpoint
// EAGERLY at definition time, and ES imports evaluate before this line runs, so
// this only reaches the callables defined inline below. The top-imported modules
// (the triggers, regenerateCanonIcon, beforeMemberCreated) pin memory inline —
// the same reason they already pin region inline.
setGlobalOptions({ region: 'europe-west2', memory: '512MiB' });

// Telemetry, owned at module load so it's in place before any flow runs:
//
//  1. enableFirebaseTelemetry() owns the single process-wide OTel
//     NodeTracerProvider — it is the Genkit-native telemetry integration, so
//     every exported callable flow and the onCanonItemWritten trigger emit
//     spans/metrics through it (to Firebase Genkit Monitoring in prod). It is
//     safe in the local emulator: with GENKIT_ENV=dev and forceDevExport off
//     (the default) it does not export to GCP, so absent credentials never
//     crash. Wrapped so a telemetry-init failure can never take down the CF.
//     Once it resolves (the provider is registered), attachAiOtlpSpanProcessor()
//     adds our PostHog AI-OTLP span processor to that same provider, so Genkit's
//     AI spans are remapped (genkit:* → gen_ai.*/ai.*) and shipped to PostHog LLM
//     observability as real traces (#356), and attachDistributedSpanProcessor()
//     adds — alongside it — the distributed-tracing processor, which ships EVERY
//     finished span to PostHog's /i/v1/traces endpoint so the whole invocation
//     (canon matching + parents + infra) renders as one coherent trace correlated
//     by trace_id to the AI generations. Both no-op without POSTHOG_API_KEY and
//     are suppressed under GENKIT_TELEMETRY_SERVER (local dev → Genkit Dev UI only;
//     set SALT_AI_OTLP_LOCAL=1 to opt back in for deliberate local verification).
//  2. PostHog server telemetry (posthog-node) — the cf-path canon.match event and
//     server error reporting (AI model/token/cost now rides the AI-OTLP spans in
//     (1), not a flat $ai_generation event). No-ops when POSTHOG_API_KEY is absent
//     (e.g. an emulator run without the secret).
//  3. registerGenkitDevTracing() points Genkit's native trace export at the
//     local Dev UI when GENKIT_TELEMETRY_SERVER is set (pnpm dev:emulators).
try {
  // Arm the trigger telemetry-readiness gate (issue #370) with the boot promise:
  // Firestore triggers await it before extracting a supplied trace, so a cold-
  // started handler does not run the OTel propagator/context-manager before this
  // async init lands (which silently dropped the trace and re-rooted the flow).
  // armCfTelemetry SETTLES readiness on rejection too, so a telemetry-export setup
  // failure (e.g. no GCP creds locally) degrades to a root trace without a separate
  // .catch and without an unhandled rejection.
  armCfTelemetry(
    enableFirebaseTelemetry().then(() => {
      attachAiOtlpSpanProcessor();
      attachDistributedSpanProcessor();
    }),
  );
} catch {
  // enableFirebaseTelemetry is async, but guard the synchronous path too.
}
initServerObservability(process.env['POSTHOG_API_KEY'] ?? '', resolveServerEnvironment());
registerGenkitDevTracing();

const geminiApiKey = defineSecret('GEMINI_API_KEY');
// PostHog project API key for server-side telemetry (posthog-node) in the
// AI/match functions. Optional — when unset, server observability no-ops and
// firebase-functions/logger still emits match logs additively.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// APP_CHECK_ENFORCEMENT (monitor-first App Check, #145) is owned by
// ./tracedCallable.js so the traced-callable factory applies it uniformly; it is
// imported here for the onCallGenkit / non-traced onCall callables below.

export const embedText = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  embedTextFlow,
);

export const arbitrateCanon = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    // posthogApiKey bound so this function's AI spans reach PostHog when
    // arbitrateCanon runs as its own callable. The key is both the posthog-node
    // key (canon.match / error reporting) AND the bearer token for the AI-OTLP
    // span exporter; without it the exporter no-ops in this function's process
    // (it only ships when invoked inside a posthog-bound parent like
    // matchOrCreateCanon).
    secrets: [geminiApiKey, posthogApiKey],
    authPolicy: isSignedIn(),
  },
  arbitrateCanonFlow,
);

// ─── Browser→CF trace continuity (issue #362, Phase 3) ────────────────────────
//
// These USER-INITIATED callables run their flow within a W3C trace context so the
// flow span nests under one coherent invocation trace instead of re-rooting. The
// whole entrypoint sequence — auth → wire safeParse → strip `traceparent` →
// env-gated trace propagation (browser-supplied field WINS over the inbound GCP
// header) → report-and-flush — lives in
// makeTracedCallable (./tracedCallable.ts, issue #415), so each callable below is
// just a declaration and the happy-path span flush is guaranteed uniform.
export const matchOrCreateCanon = makeTracedCallable({
  wireSchema: MatchOrCreateCanonWireInputSchema,
  flow: matchOrCreateCanonFlow,
  options: { secrets: [geminiApiKey, posthogApiKey] },
});

// Batch callable: one canon-collection read + batched embeddings for a full
// recipe. Mirrors matchOrCreateCanon's port-wiring but fans inputs through
// matchOrCreateBatch so later items see items created earlier in the batch.
// Memory-heavy (whole-canon read + batched embeddings); covered by the 512MiB
// global floor — at 256 it OOM-killed (500/504 + a browser CORS error, since the
// dead response carries no CORS headers).
export const canonicaliseRecipeIngredients = makeTracedCallable({
  wireSchema: CanonicaliseRecipeIngredientsWireInputSchema,
  flow: canonicaliseRecipeIngredientsFlow,
  options: { secrets: [geminiApiKey, posthogApiKey], timeoutSeconds: 120 },
});

// Add-equipment grouping (issue #361). The multi-step add-equipment action fires
// identifyEquipment then populateEquipmentEntry with human think-time between; the
// browser mints ONE trace id and supplies the SAME `traceparent` to both calls, so
// both flows nest under one trace instead of re-rooting two. posthogApiKey is the
// bearer token for the AI-OTLP span exporter (and the posthog-node key) AND lets
// the entrypoint catch report a flow failure.
export const identifyEquipment = makeTracedCallable({
  wireSchema: IdentifyEquipmentWireInputSchema,
  flow: identifyEquipmentFlow,
  options: { secrets: [geminiApiKey, posthogApiKey] },
});

export const populateEquipmentEntry = makeTracedCallable({
  wireSchema: PopulateEquipmentEntryWireInputSchema,
  flow: populateEquipmentEntryFlow,
  options: { secrets: [geminiApiKey, posthogApiKey] },
});

// Recipe lists are larger prompts than single-entry flows — allow 90s so the
// 55s withAiTimeout has sufficient headroom within the function lifetime.
export const parseRecipeIngredients = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    // posthogApiKey bound so this function's AI spans reach PostHog: it is the
    // bearer token for the AI-OTLP span exporter (and the posthog-node key).
    // Without it the exporter no-ops in this function's process, so this
    // callable's AI usage never lands in PostHog.
    secrets: [geminiApiKey, posthogApiKey],
    authPolicy: isSignedIn(),
    timeoutSeconds: 90,
  },
  parseRecipeIngredientsFlow,
);

// Librarian: conversation → recipe draft with canon-matched ingredients. The
// default error handler reports the librarian flow failure (AI + batch
// canonicalise) and re-throws unchanged. Memory comes from the 512MiB global
// floor. #415 added the happy-path span flush this callable previously lacked.
export const authorRecipe = makeTracedCallable({
  wireSchema: AuthorRecipeWireInputSchema,
  flow: authorRecipeFlow,
  options: { secrets: [geminiApiKey, posthogApiKey], timeoutSeconds: 120 },
});

// Scene brief on demand (issue #522, Phase 3): read the recipe → return the
// art-direction paragraph that will direct its hero image. Two shapes, one flow:
// with a `currentBrief` + `hint` it REVISES ("make it summery", folded through);
// with neither it authors from scratch, which is what "start over" sends so a
// substantially rewritten recipe can shed art direction describing the old dish.
//
// PERSISTS NOTHING — deliberately. The brief goes back to the dialog, still
// editable, and only ever reaches Firestore when the user commits by pressing
// Regenerate (regenerateRecipeImage stamps `imageBrief`). That is the economics of
// the feature: revising is a fraction of a cent and touches no doc, so you can
// iterate the art direction freely and only pay for an image once it is right —
// three brief revisions and one good image, not three images and a shrug. A
// revision that auto-saved would also silently overwrite the brief behind the
// image currently on screen, which is not what "let me see it first" means.
//
// Auth posture mirrors the image callables: signed-in only, NO admin gate —
// recipes are member-writable by design and the gate here is on AI cost, not on
// authority. This is a plain text flow (no fetch, no image), so the house
// text-flow timeout is plenty.
export const describeRecipeScene = makeTracedCallable({
  wireSchema: DescribeRecipeSceneWireInputSchema,
  flow: describeRecipeSceneFlow,
  options: { secrets: [geminiApiKey, posthogApiKey], timeoutSeconds: 90 },
});

// SSRF-hardened URL import (recipe URL import epic). A custom onError maps the
// flow's UrlImportError taxonomy to specific HttpsError codes with user-safe copy
// (no internal SSRF detail leaked). The flow does outbound DNS + a network fetch
// in addition to the AI call, so the function timeout is generous. Memory comes
// from the 512MiB global floor.
function mapUrlImportFailure(code: UrlImportFailureCode): HttpsError {
  switch (code) {
    case 'invalid-url':
      return new HttpsError('invalid-argument', "That doesn't look like a valid web address.");
    case 'blocked-url':
      // No internal detail leaked.
      return new HttpsError('invalid-argument', "That link can't be imported.");
    case 'fetch-failed':
      return new HttpsError(
        'unavailable',
        "We couldn't reach that page — it may be down, paywalled, or blocking us.",
      );
    case 'not-a-recipe':
      return new HttpsError('failed-precondition', "We couldn't find a recipe on that page.");
    case 'ai-failed':
      return new HttpsError(
        'internal',
        'The recipe reader had trouble with that page — try again, or add it manually.',
      );
  }
}

export const extractRecipeFromUrl = makeTracedCallable({
  wireSchema: ExtractRecipeFromUrlWireInputSchema,
  flow: extractRecipeFromUrlFlow,
  options: { secrets: [geminiApiKey, posthogApiKey], timeoutSeconds: 120 },
  // A bad wire envelope is a malformed URL from the client — user-safe copy.
  invalidArgumentMessage: "That doesn't look like a valid web address.",
  // Report the GENUINE cause before mapping to a user-facing HttpsError — the raw
  // error/stack, never the HttpsError envelope. The UrlImportError taxonomy
  // encodes EXPECTED user outcomes (bad/blocked URL, unreachable page,
  // not-a-recipe) which are suppressed per policy; only `ai-failed` (the
  // recipe-reader model itself failing) is the unexpected one worth surfacing. A
  // non-UrlImportError throw is an unexpected bug → report.
  onError: async (err) => {
    if (err instanceof UrlImportError) {
      if (err.code === 'ai-failed') await reportFlowError(err);
      throw mapUrlImportFailure(err.code);
    }
    await reportFlowError(err);
    throw new HttpsError(
      'internal',
      'The recipe reader had trouble with that page — try again, or add it manually.',
    );
  },
});

export const chefChat = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
    authPolicy: isSignedIn(),
    timeoutSeconds: 120,
    // Memory-heavy: pro-tier streaming + equipment/recipe/history context reads.
    // Covered by the 512MiB global floor — at 256 it OOM'd ("263 MiB used"), and
    // the SIGKILL killed the instance before enableFirebaseTelemetry flushed the
    // flow span, so it never appeared in Genkit Monitoring.
  },
  chefChatFlow,
);

export const generateChatTitle = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
    authPolicy: isSignedIn(),
  },
  generateChatTitleFlow,
);

// Admin-only AI model catalog + probe (Phase 3 — admin-managed model selection).
// Both re-check admin server-side (issue #155) and declare the AI secret so the
// catalog fetch / probe can read GEMINI_API_KEY from process.env. App Check
// monitor-first like every other callable. POSTHOG_API_KEY is bound so an
// unexpected throw can be reported (the handlers map every EXPECTED operational
// outcome to an HttpsError / a `{ ok:false }` result, so only a non-HttpsError
// escaping is reported — see reportUnexpected).
//
// reportUnexpected: report a genuine bug (a non-HttpsError throw) before it
// propagates, then re-throw unchanged. An HttpsError is an outcome the handler /
// requireAdmin deliberately classified (auth, permission, unavailable catalog) —
// expected, so suppressed. Flush before return so the report is not stranded.
async function reportUnexpected<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!(err instanceof HttpsError)) await reportFlowError(err);
    throw err;
  }
}

export const listAiModels = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
  },
  (request) => reportUnexpected(() => handleListAiModels(request)),
);

export const testModel = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
  },
  (request) => reportUnexpected(() => handleTestModel(request)),
);

// Forecast fetch + cache pipeline (issue #382, Phase 2). Callable by any
// signed-in member — deliberately NOT admin-gated (issue #408): the meal planner
// silently refreshes a stale forecast on access for every member
// (weatherService.ensureFreshForecast, force=false), and a manual refresh button
// in the settings UI passes force=true to bypass the staleness re-check. It
// follows the same browser-supplied-trace pattern as the canon-matching callables
// (validate the WIRE envelope, strip `traceparent`, run within the propagated
// trace context, report + flush), so it uses the same makeTracedCallable factory.
// No AI, so only posthogApiKey is bound (error reporting + the distributed-trace
// OTLP bearer); no geminiApiKey, no withAiTimeout. The heavy lifting (read home
// location, staleness re-check, Open-Meteo fetch + validate, pure aggregation,
// Firestore write) lives in runRefreshWeatherForecast; the default onError reports
// an unexpected server failure (Firestore read/write, Open-Meteo fetch, or a
// malformed external payload) and re-throws unchanged.
export const refreshWeatherForecast = makeTracedCallable({
  wireSchema: RefreshWeatherForecastWireInputSchema,
  flow: (input) => runRefreshWeatherForecast(input),
  options: { secrets: [posthogApiKey], timeoutSeconds: 30 },
});

export { onShoppingListItemWrite };
export { onCanonItemWritten };
export { onRecipeWritten };
export { regenerateCanonIcon } from './callables/regenerateCanonIcon.js';
export { regenerateRecipeImage } from './callables/regenerateRecipeImage.js';
export { setRecipeImageUpload } from './callables/setRecipeImageUpload.js';
export { beforeMemberCreated } from './auth/beforeMemberCreated.js';
