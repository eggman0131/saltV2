import { z } from 'genkit';
import { matchOrCreateBatch } from '@salt/domain';
import type { MatchOrCreateInput } from '@salt/domain';
import { CanonicaliseRecipeIngredientsInputSchema } from '@salt/domain/schemas';
import {
  flushServerObservability,
  startSpan,
  whenServerObservabilityReady,
} from '@salt/observability/server';
import { ai } from '../genkit.js';
import { buildMatchOrCreatePorts } from './matchOrCreateCanon.js';

const ItemResultSchema = z.union([
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

const OutputSchema = z.array(ItemResultSchema);

export const canonicaliseRecipeIngredientsFlow = ai.defineFlow(
  {
    name: 'canonicaliseRecipeIngredients',
    inputSchema: CanonicaliseRecipeIngredientsInputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => {
    await whenServerObservabilityReady();
    const inputs: MatchOrCreateInput[] = input.items.map((item) => ({
      rawName: item.rawName,
      ...(item.rawText !== undefined ? { rawText: item.rawText } : {}),
      ...(item.selectedAisleId !== undefined ? { selectedAisleId: item.selectedAisleId } : {}),
    }));
    // One parent span for the whole batch so every per-item canon span is
    // parented under a single trace. Without this the batch passes no parent to
    // buildMatchOrCreatePorts, so each item's match-log span roots its own
    // trace — N near-identical traces for one recipe.
    const batchSpan = startSpan(`canon.canonicaliseRecipeBatch: ${inputs.length} items`);
    try {
      batchSpan.setAttribute('canon.batchSize', inputs.length);
      return await matchOrCreateBatch(inputs, buildMatchOrCreatePorts(batchSpan));
    } finally {
      batchSpan.end();
      await flushServerObservability();
    }
  },
);
