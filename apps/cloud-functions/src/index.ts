import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onCall, onCallGenkit, isSignedIn, HttpsError } from 'firebase-functions/https';
import { onDocumentWritten } from 'firebase-functions/firestore';
import { logger } from 'firebase-functions';
import { normaliseName } from '@salt/domain';
import {
  initServerObservability,
  isServerObservabilityInitialised,
  runWithExtractedTraceContext,
  whenServerObservabilityReady,
} from '@salt/ld-observability/server';
import { registerGenkitDevTracing } from './genkitTracing.js';
import { embedTextFlow } from './flows/embedText.js';
import { arbitrateCanonFlow } from './flows/arbitrateCanon.js';
import { matchOrCreateCanonFlow } from './flows/matchOrCreateCanon.js';

initializeApp();

const geminiApiKey = defineSecret('GEMINI_API_KEY');
// LaunchDarkly server SDK key for observability in matchOrCreateCanon.
// Optional — when unset, the flow falls back to firebase-functions/logger only.
const ldSdkKey = defineSecret('LD_SDK_KEY');

export const embedText = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  embedTextFlow,
);

export const arbitrateCanon = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  arbitrateCanonFlow,
);

// Manual onCall (instead of onCallGenkit) so we can extract the W3C trace
// context from the request body and set it as the active OTel context BEFORE
// Genkit opens the flow span. Otherwise Genkit's flow root starts a fresh
// trace and the Genkit/Firestore child spans never join the browser's trace.
export const matchOrCreateCanon = onCall(
  {
    secrets: [geminiApiKey, ldSdkKey],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    // Init LD observability before extracting trace context, so the global
    // tracer provider is registered when Genkit's flow span opens.
    // initServerObservability is synchronous, so registerGenkitDevTracing can
    // follow immediately — both complete before whenServerObservabilityReady().
    const sdkKey = process.env['LD_SDK_KEY'];
    if (sdkKey && !isServerObservabilityInitialised()) {
      initServerObservability(sdkKey);
      registerGenkitDevTracing();
    }
    await whenServerObservabilityReady();

    const data = request.data as { _trace?: Record<string, string> };
    return runWithExtractedTraceContext(data?._trace, () => matchOrCreateCanonFlow(request.data));
  },
);

export const onCanonItemWritten = onDocumentWritten(
  {
    document: 'canonItems/{id}',
    secrets: [geminiApiKey],
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const data = after.data() as Record<string, unknown>;
    if (typeof data['deletedAt'] === 'string') return;
    if (Array.isArray(data['embedding'])) return;

    const name = typeof data['name'] === 'string' ? data['name'] : null;
    if (!name) return;

    const normalised = normaliseName(name);
    if (!normalised) return;

    try {
      const { values } = await embedTextFlow({ text: normalised });
      await getFirestore()
        .collection('canonItems')
        .doc(event.params.id)
        .update({ embedding: values });
    } catch (err) {
      logger.error('onCanonItemWritten: embedding failed', { id: event.params.id, err });
    }
  },
);
