import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { onCall, onCallGenkit, isSignedIn, HttpsError } from 'firebase-functions/https';
import {
  MatchOrCreateCanonWireInputSchema,
  CanonicaliseRecipeIngredientsWireInputSchema,
  AuthorRecipeWireInputSchema,
  ExtractRecipeFromUrlWireInputSchema,
} from '@salt/domain/schemas';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import {
  initServerObservability,
  whenServerObservabilityReady,
  runWithExtractedTraceContext,
  runWithSuppliedTraceContext,
  attachAiOtlpSpanProcessor,
  attachDistributedSpanProcessor,
} from '@salt/observability/server';
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
// The canon-matching callables run their flow within a W3C trace context so the
// flow span nests under one coherent invocation trace instead of re-rooting.
// These are USER-INITIATED callables, so the browser-supplied field is the
// PREFERRED channel. There are TWO sources for that context, applied with this
// precedence:
//   1. A browser-SUPPLIED `traceparent` carried as a NAMED, TYPED, OPTIONAL
//      field on the callable WIRE input. The Firebase JS callable SDK cannot
//      carry a custom `traceparent` HTTP header (HttpsCallableOptions is only
//      { timeout?, limitedUseAppCheckTokens? } and the transport sets its own
//      fixed headers), so a browser-minted trace id can ONLY ride as this field.
//      It is schema-validated and stripped here before the flow runs — NOT the
//      forbidden magic `_trace`. (Phase 4 mints the real browser trace id;
//      until then it is synthetic/test.) Preferred — it is the only channel that
//      can unify the browser action with the server flow.
//   2. Else the inbound W3C trace HEADER on the underlying request
//      (request.rawRequest.headers). This is GCP's FRESH request-trace root, so
//      it can never carry the browser's trace id — it is the fallback only when
//      no non-empty supplied field is present.
//
// Env-gated on GENKIT_TELEMETRY_SERVER (set only by `pnpm dev:emulators`):
//   • Local dev (set): SUPPRESS propagation — run the flow without installing
//     any parent context, so it stays root-listed in the Genkit Dev UI (whose
//     trace list only surfaces flow-rooted traces). This is the gate that
//     resolves the 2026-05-11 regression that previously parked propagation.
//   • Production (unset): honour the trace context per the precedence above via
//     runWithExtractedTraceContext / runWithSuppliedTraceContext (both degrade
//     to a plain call when no context is present, and never throw — Rule 10).
//
// A malformed/absent traceparent must NOT fail the call: it is optional and
// best-effort, so we just skip propagation. Only a malformed WIRE ENVELOPE
// (bad domain input) is rejected — with HttpsError('invalid-argument').
function runFlowWithTraceContext<T>(
  domainInput: unknown,
  headers: import('node:http').IncomingHttpHeaders | undefined,
  traceparent: string | undefined,
  flow: (input: never) => T,
): T {
  // Local dev: suppress propagation so flows stay root-listed in the Dev UI.
  if (process.env['GENKIT_TELEMETRY_SERVER']) {
    return flow(domainInput as never);
  }
  // Production. For these user-INITIATED callables the browser-supplied
  // `traceparent` field WINS: it is the only channel that can carry the
  // browser's trace id (the Firebase callable SDK can't carry a custom HTTP
  // header), so it is the one that actually unifies the browser action with the
  // server flow. The inbound W3C header is GCP's FRESH request-trace root —
  // preferring it would re-root away from the browser trace and could never
  // unify with it — so it is the fallback only when no non-empty field is
  // present. Both helpers degrade safely to a plain call (Rule 10).
  if (traceparent) {
    return runWithSuppliedTraceContext(traceparent, () => flow(domainInput as never));
  }
  return runWithExtractedTraceContext(headers ?? {}, () => flow(domainInput as never));
}

// Manual onCall (instead of onCallGenkit) so we can install the trace context as
// the active OTel context BEFORE Genkit opens the flow span — so the flow span
// nests under the request trace and each invocation renders as ONE coherent
// trace, instead of the flow re-rooting a fresh trace. See runFlowWithTraceContext
// above for the field→header precedence and env-gating.
export const matchOrCreateCanon = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, posthogApiKey],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    // Validate the WIRE envelope (domain input + optional traceparent). Strip
    // traceparent so the flow receives the PURE domain input (domain purity).
    const parsed = MatchOrCreateCanonWireInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const { traceparent, ...domainInput } = parsed.data;

    await whenServerObservabilityReady();

    try {
      // The report() lives in the catch and never touches the active context.
      return await runFlowWithTraceContext(
        domainInput,
        request.rawRequest?.headers,
        traceparent,
        matchOrCreateCanonFlow,
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
    const parsed = CanonicaliseRecipeIngredientsWireInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const { traceparent, ...domainInput } = parsed.data;
    await whenServerObservabilityReady();
    try {
      return await runFlowWithTraceContext(
        domainInput,
        request.rawRequest?.headers,
        traceparent,
        canonicaliseRecipeIngredientsFlow,
      );
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
    const parsed = AuthorRecipeWireInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const { traceparent, ...domainInput } = parsed.data;
    await whenServerObservabilityReady();
    try {
      return await runFlowWithTraceContext(
        domainInput,
        request.rawRequest?.headers,
        traceparent,
        authorRecipeFlow,
      );
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
    const parsed = ExtractRecipeFromUrlWireInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', "That doesn't look like a valid web address.");
    }
    const { traceparent, ...domainInput } = parsed.data;
    await whenServerObservabilityReady();
    try {
      return await runFlowWithTraceContext(
        domainInput,
        request.rawRequest?.headers,
        traceparent,
        extractRecipeFromUrlFlow,
      );
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
