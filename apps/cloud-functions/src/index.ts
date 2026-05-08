import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onCallGenkit, isSignedIn } from 'firebase-functions/https';
import { onDocumentWritten } from 'firebase-functions/firestore';
import { logger } from 'firebase-functions';
import { normaliseName } from '@salt/domain';
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

export const matchOrCreateCanon = onCallGenkit(
  {
    secrets: [geminiApiKey, ldSdkKey],
    authPolicy: isSignedIn(),
  },
  matchOrCreateCanonFlow,
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
