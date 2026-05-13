import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { onCall, onCallGenkit, isSignedIn, HttpsError } from 'firebase-functions/https';
import { onDocumentWritten } from 'firebase-functions/firestore';
import { logger } from 'firebase-functions';
import { normaliseName } from '@salt/domain';
import {
  initServerObservability,
  whenServerObservabilityReady,
} from '@salt/ld-observability/server';
import { registerGenkitDevTracing } from './genkitTracing.js';
import { embedTextFlow } from './flows/embedText.js';
import { arbitrateCanonFlow } from './flows/arbitrateCanon.js';
import { matchOrCreateCanonFlow } from './flows/matchOrCreateCanon.js';
import { identifyEquipmentFlow } from './flows/identifyEquipment.js';
import { populateEquipmentEntryFlow } from './flows/populateEquipmentEntry.js';

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
    secrets: [geminiApiKey, ldSdkKey],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    await whenServerObservabilityReady();

    // DORMANT: trace propagation — see block comment above.
    // Was: runWithExtractedTraceContext(data?._trace, () => matchOrCreateCanonFlow(request.data))
    return matchOrCreateCanonFlow(request.data);
  },
);

export const identifyEquipment = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  identifyEquipmentFlow,
);

export const populateEquipmentEntry = onCallGenkit(
  {
    secrets: [geminiApiKey],
    authPolicy: isSignedIn(),
  },
  populateEquipmentEntryFlow,
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
