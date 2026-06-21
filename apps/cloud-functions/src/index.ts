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
import {
  initServerObservability,
  whenServerObservabilityReady,
} from '@salt/ld-observability/server';
import { registerGenkitDevTracing } from './genkitTracing.js';
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

setGlobalOptions({ region: 'europe-west2' });

// Initialise LD observability and Genkit dev-trace routing at module load so
// every exported callable flow (embedText, arbitrateCanon, matchOrCreateCanon,
// identifyEquipment, populateEquipmentEntry) and the onCanonItemWritten
// trigger share the same OTel provider and forward their Genkit spans to the
// dev server when GENKIT_TELEMETRY_SERVER is set.
const _ldSdkKeyAtLoad = process.env['LD_SDK_KEY'];
if (_ldSdkKeyAtLoad) {
  initServerObservability(_ldSdkKeyAtLoad);
  registerGenkitDevTracing();
}

const geminiApiKey = defineSecret('GEMINI_API_KEY');
// LaunchDarkly server SDK key for observability in matchOrCreateCanon.
// Optional — when unset, the flow falls back to firebase-functions/logger only.
const ldSdkKey = defineSecret('LD_SDK_KEY');

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
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  arbitrateCanonFlow,
);

// Manual onCall (instead of onCallGenkit) so we *could* extract the W3C trace
// context from the request body and set it as the active OTel context BEFORE
// Genkit opens the flow span — joining the browser's trace to the CF trace.
//
// DORMANT: trace propagation is intentionally disabled below (see the
// `return matchOrCreateCanonFlow(...)` site). Reason: parenting the flow span
// under the browser span makes it a non-root in OTel, and the Genkit Dev UI's
// trace list only surfaces flow-rooted traces — so unified traces in LD came
// at the cost of zero traces in the local dev view. The owner accepts split
// browser/CF traces in LD to keep the Dev UI working. To re-enable unified
// traces, restore the `runWithExtractedTraceContext` wrapper below; the
// supporting plumbing (`_trace` payload field, `extractTraceHeaders` on the
// browser, `runWithExtractedTraceContext` in @salt/ld-observability/server)
// is still in place. Search for "DORMANT: trace propagation" to find all
// sites at once.
export const matchOrCreateCanon = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, ldSdkKey],
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

    // DORMANT: trace propagation — see block comment above.
    // Was: runWithExtractedTraceContext(data?._trace, () => matchOrCreateCanonFlow(request.data))
    return matchOrCreateCanonFlow(request.data);
  },
);

// Batch callable: one canon-collection read + batched embeddings for a full
// recipe. Mirrors matchOrCreateCanon's port-wiring but fans inputs through
// matchOrCreateBatch so later items see items created earlier in the batch.
export const canonicaliseRecipeIngredients = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, ldSdkKey],
    timeoutSeconds: 120,
    // Batch canonicalisation reads the whole canon collection and batches
    // embeddings for every ingredient in the recipe, so it exceeds the default
    // 256 MiB and the instance is OOM-killed (surfaces as 500/504 + a CORS
    // error in the browser because the dead response carries no CORS headers).
    memory: '512MiB',
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
    return canonicaliseRecipeIngredientsFlow(parsed.data);
  },
);

export const identifyEquipment = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  identifyEquipmentFlow,
);

export const populateEquipmentEntry = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  populateEquipmentEntryFlow,
);

// Recipe lists are larger prompts than single-entry flows — allow 90s so the
// 55s withAiTimeout has sufficient headroom within the function lifetime.
export const parseRecipeIngredients = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
    timeoutSeconds: 90,
  },
  parseRecipeIngredientsFlow,
);

// Librarian: conversation → recipe draft with canon-matched ingredients.
// Uses onCall (not onCallGenkit) so we can bump memory for the batch
// canonicalisation, mirroring canonicaliseRecipeIngredients.
export const authorRecipe = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey, ldSdkKey],
    timeoutSeconds: 120,
    memory: '512MiB',
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
    return authorRecipeFlow(parsed.data);
  },
);

// SSRF-hardened URL import (recipe URL import epic). Uses onCall (not
// onCallGenkit) so we can map the flow's UrlImportError taxonomy to specific
// HttpsError codes with user-safe copy (no internal SSRF detail leaked), and
// bump memory for the batch canonicalisation like authorRecipe. The flow does
// outbound DNS + a network fetch in addition to the AI call, so the function
// timeout is generous.
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
    secrets: [geminiApiKey, ldSdkKey],
    timeoutSeconds: 120,
    memory: '512MiB',
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
      if (err instanceof UrlImportError) throw mapUrlImportFailure(err.code);
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
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
    timeoutSeconds: 120,
  },
  chefChatFlow,
);

export const generateChatTitle = onCallGenkit(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  generateChatTitleFlow,
);

// Admin-only AI model catalog + probe (Phase 3 — admin-managed model selection).
// Both re-check admin server-side (issue #155) and declare the AI secret so the
// catalog fetch / probe can read GEMINI_API_KEY from process.env. App Check
// monitor-first like every other callable.
export const listAiModels = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey],
  },
  handleListAiModels,
);

export const testModel = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    secrets: [geminiApiKey],
  },
  handleTestModel,
);

export { onShoppingListItemWrite };
export { onCanonItemWritten };
export { regenerateCanonIcon } from './callables/regenerateCanonIcon.js';
export { beforeMemberCreated } from './auth/beforeMemberCreated.js';
