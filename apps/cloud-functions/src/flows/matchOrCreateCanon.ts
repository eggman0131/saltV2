import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { matchOrCreate } from '@salt/domain';
import type { MatchOrCreateInput, MatchOrCreatePorts } from '@salt/domain';
import { ai } from '../genkit.js';
import { createFirestoreCanonStore } from '../adapters/firestoreCanonStore.js';
import { createFirestoreAisleStore } from '../adapters/firestoreAisleStore.js';
import { createServerEmbeddingAdapter } from '../adapters/serverEmbedding.js';
import { createServerArbitrationAdapter } from '../adapters/serverArbitration.js';
import { createServerMatchLoggingAdapter } from '../adapters/serverMatchLog.js';

const InputSchema = z.object({
  rawName: z.string(),
  selectedAisleId: z.string().nullable().optional(),
  forceCreate: z.boolean().optional(),
});

// Output is the Result envelope produced by matchOrCreate. CanonItem and
// DomainError are validated upstream by the domain layer; modelling them
// again in zod would just duplicate that contract.
const OutputSchema = z.union([
  z.object({
    kind: z.literal('ok'),
    value: z.object({
      decision: z.enum(['created', 'matched', 'ai_arbitrated']),
      item: z.any(),
    }),
  }),
  z.object({
    kind: z.literal('err'),
    error: z.any(),
  }),
]);

export function buildMatchOrCreatePorts(): MatchOrCreatePorts {
  const db = getFirestore();
  return {
    store: createFirestoreCanonStore(db),
    aisleStore: createFirestoreAisleStore(db),
    embedding: createServerEmbeddingAdapter(),
    arbitration: createServerArbitrationAdapter(),
    ids: { newCanonId: () => crypto.randomUUID(), newAisleId: () => crypto.randomUUID() },
    logging: createServerMatchLoggingAdapter(),
  };
}

export const matchOrCreateCanonFlow = ai.defineFlow(
  {
    name: 'matchOrCreateCanon',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => {
    // exactOptionalPropertyTypes: spread optional fields only when defined.
    const cleanInput: MatchOrCreateInput = {
      rawName: input.rawName,
      ...(input.selectedAisleId !== undefined && { selectedAisleId: input.selectedAisleId }),
      ...(input.forceCreate !== undefined && { forceCreate: input.forceCreate }),
    };
    return matchOrCreate(cleanInput, buildMatchOrCreatePorts());
  },
);
