import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { onCall, onCallGenkit, isSignedIn, HttpsError } from 'firebase-functions/https';
import {
  MatchOrCreateCanonInputSchema,
  CanonicaliseRecipeIngredientsInputSchema,
  AuthorRecipeInputSchema,
  ExtractRecipeFromUrlInputSchema,
} from '@salt/domain/schemas';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import {
  initServerObservability,
  whenServerObservabilityReady,
  runWithExtractedTraceContext,
} from '@salt/observability/server';
import { registerGenkitDevTracing } from './genkitTracing.js';
import { reportFlowError } from './observability/reportServerError.js';
import { resolveServerEnvironment } from './observability/environment.js';
import { embedTextFlow } from './flows/embedText.js';
import { arbitrateCanonFlow } from './flows/arbitrateCanon.js';
import { matchOrCreateCanonFlow } from './flows/matchOrCreateCanon.js';
import { canonicaliseRecipeIngredientsFlow } from './flows/canonicaliseRecipeIngredients.js';
import { identifyEquipmentFlow } from './flows/identifyEquipment.js';
import { populateEquipmentEntryFlow } from './flows/populateEquipmentEntry.js';
import { parseRecipeIngredientsFlow } from './flows/parseRecipeIngredients.js';
import { chefChatFlow } from './flows/chefChat.js';
import { authorRecipeFlow } from './flows/authorRecipe.js';
import {
  extractRecipeFromUrlFlow,
  UrlImportError,
  type UrlImportFailureCode,
} from './flows/extractRecipeFromUrl.js';
import { generateChatTitleFlow } from './flows/generateChatTitle.js';
import { onShoppingListItemWrite } from './triggers/onShoppingListItemWrite.js';
import { onCanonItemWritten } from './triggers/onCanonItemWritten.js';
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
//  2. PostHog server telemetry (posthog-node) — the $ai_generation cost events,
//     the cf-path canon.match event, and server error reporting. No-ops when
//     POSTHOG_API_KEY is absent (e.g. an emulator run without the secret).
//  3. registerGenkitDevTracing() points Genkit's native trace export at the
//     local Dev UI when GENKIT_TELEMETRY_SERVER is set (pnpm dev:emulators).
try {
  void enableFirebaseTelemetry().catch(() => {
    // Non-fatal: telemetry export setup failed (e.g. no GCP creds locally).
  });
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

// App Check enforcement for every callable. Monitor-first (#145): unverified
// requests are still allowed but reported to App Check metrics. Flip this single
// line to `true` once staging metrics confirm legitimate traffic verifies — that
// is the enforcement step of the rollout (callables first, the AI cost surface).
const APP_CHECK_ENFORCEMENT = { enforceAppCheck: false } as const;

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
    // posthogApiKey bound so the flow's tracedGenerate $ai_generation emit
    // reaches PostHog when arbitrateCanon runs as its own callable. Without it,
    // initServerObservability gets an empty key in this function's process and
    // the emit silently no-ops (it only worked when invoked inside a
    // posthog-bound parent like matchOrCreateCanon).
    secrets: [geminiApiKey, posthogApiKey],
    authPolicy: isSignedIn(),
  },
  arbitrateCanonFlow,
);

// Manual onCall (instead of onCallGenkit) so we can extract the inbound W3C
// trace context and install it as the active OTel context BEFORE Genkit opens
// the flow span — so the flow span nests under the platform request span and
// each invocation renders as ONE coherent trace, instead of the flow re-rooting
// a fresh trace.
//
// Env-gated on GENKIT_TELEMETRY_SERVER (set only by `pnpm dev:emulators`):
//   • Local dev (set): SUPPRESS propagation — run the flow without installing
//     any parent context, so it stays root-listed in the Genkit Dev UI (whose
//     trace list only surfaces flow-rooted traces). This is the gate that
//     resolves the 2026-05-11 regression that previously parked propagation.
//   • Production (unset): honour the inbound trace context. The platform/GCP
//     injects W3C trace headers on the underlying request; we read them off
//     request.rawRequest.headers and run the flow within the extracted context
//     via runWithExtractedTraceContext (which degrades to a plain call when no
//     context is present, and never throws).
export const matchOrCreateCanon = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const parsed = MatchOrCreateCanonInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }

    await whenServerObservabilityReady();

    try {
      // Suppress propagation locally so flows stay root-listed in the Dev UI.
      if (process.env['GENKIT_TELEMETRY_SERVER']) {
        return await matchOrCreateCanonFlow(request.data);
      }
      // Production: nest the flow span under the inbound request trace. The
      // trace flow (env-gate + runWithExtractedTraceContext) is unchanged — the
      // report() lives in the catch and never touches the active context.
      return await runWithExtractedTraceContext(request.rawRequest?.headers, () =>
        matchOrCreateCanonFlow(request.data),
      );
    } catch (err) {
      // AI/Genkit flow failure (incl. AiTimeoutError). Report the genuine cause
      // additively, flush, then re-throw so the callable's error path is
      // unchanged. matchOrCreateCanonFlow's own finally also flushes; flush is
      // idempotent + non-throwing.
      await reportFlowError(err);
      throw err;
    }
  },
);

// Batch callable: one canon-collection read + batched embeddings for a full
// recipe. Mirrors matchOrCreateCanon's port-wiring but fans inputs through
// matchOrCreateBatch so later items see items created earlier in the batch.
export const canonicaliseRecipeIngredients = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
    timeoutSeconds: 120,
    // Memory-heavy (whole-canon read + batched embeddings); covered by the
    // 512MiB global floor — at 256 it OOM-killed (500/504 + a browser CORS error,
    // since the dead response carries no CORS headers).
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const parsed = CanonicaliseRecipeIngredientsInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    await whenServerObservabilityReady();
    try {
      return await canonicaliseRecipeIngredientsFlow(parsed.data);
    } catch (err) {
      // AI/Genkit batch flow failure — report the cause additively, flush, then
      // re-throw unchanged. The flow's finally also flushes (idempotent).
      await reportFlowError(err);
      throw err;
    }
  },
);

export const identifyEquipment = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    // posthogApiKey bound so the flow's onCallGenkit-boundary error reporting
    // (reportFlowError in the flow body) can read POSTHOG_API_KEY at runtime.
    secrets: [geminiApiKey, posthogApiKey],
    authPolicy: isSignedIn(),
  },
  identifyEquipmentFlow,
);

export const populateEquipmentEntry = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
    authPolicy: isSignedIn(),
  },
  populateEquipmentEntryFlow,
);

// Recipe lists are larger prompts than single-entry flows — allow 90s so the
// 55s withAiTimeout has sufficient headroom within the function lifetime.
export const parseRecipeIngredients = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    // posthogApiKey bound so the flow's tracedGenerate $ai_generation emit
    // reaches PostHog. Without it, POSTHOG_API_KEY is absent in this function's
    // process, initServerObservability inits with an empty key, and the emit
    // silently no-ops — so this callable's AI usage never lands in PostHog.
    secrets: [geminiApiKey, posthogApiKey],
    authPolicy: isSignedIn(),
    timeoutSeconds: 90,
  },
  parseRecipeIngredientsFlow,
);

// Librarian: conversation → recipe draft with canon-matched ingredients.
// Uses onCall (not onCallGenkit) so the handler can wrap the batch-canonicalise
// flow in reportFlowError, mirroring canonicaliseRecipeIngredients. Memory comes
// from the 512MiB global floor.
export const authorRecipe = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
    timeoutSeconds: 120,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const parsed = AuthorRecipeInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    await whenServerObservabilityReady();
    try {
      return await authorRecipeFlow(parsed.data);
    } catch (err) {
      // Librarian flow failure (AI + batch canonicalise) — report the cause
      // additively, flush, then re-throw unchanged.
      await reportFlowError(err);
      throw err;
    }
  },
);

// SSRF-hardened URL import (recipe URL import epic). Uses onCall (not
// onCallGenkit) so we can map the flow's UrlImportError taxonomy to specific
// HttpsError codes with user-safe copy (no internal SSRF detail leaked). The
// flow does outbound DNS + a network fetch in addition to the AI call, so the
// function timeout is generous. Memory comes from the 512MiB global floor.
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

export const extractRecipeFromUrl = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
    timeoutSeconds: 120,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const parsed = ExtractRecipeFromUrlInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', "That doesn't look like a valid web address.");
    }
    await whenServerObservabilityReady();
    try {
      return await extractRecipeFromUrlFlow(parsed.data);
    } catch (err) {
      // Report the GENUINE cause before mapping to a user-facing HttpsError —
      // the raw error/stack, never the HttpsError envelope. The UrlImportError
      // taxonomy encodes EXPECTED user outcomes (bad/blocked URL, unreachable
      // page, not-a-recipe) which are suppressed per policy; only `ai-failed`
      // (the recipe-reader model itself failing) is the unexpected one worth
      // surfacing. A non-UrlImportError throw is an unexpected bug → report.
      if (err instanceof UrlImportError) {
        if (err.code === 'ai-failed') await reportFlowError(err);
        throw mapUrlImportFailure(err.code);
      }
      await reportFlowError(err);
      throw new HttpsError(
        'internal',
        'The recipe reader had trouble with that page — try again, or add it manually.',
      );
    }
  },
);

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

export { onShoppingListItemWrite };
export { onCanonItemWritten };
export { regenerateCanonIcon } from './callables/regenerateCanonIcon.js';
export { beforeMemberCreated } from './auth/beforeMemberCreated.js';
