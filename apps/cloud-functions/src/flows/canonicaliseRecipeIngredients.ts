import { z } from 'genkit';
import { matchOrCreateBatch } from '@salt/domain';
import type { MatchOrCreateInput } from '@salt/domain';
import { CanonicaliseRecipeIngredientsInputSchema } from '@salt/domain/schemas';
import { activeTraceparent, startSpan } from '@salt/observability/server';
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
      // Stamp the browser-rooted trace (installed as the active OTel context by
      // the field-preferred callable entrypoint, issue #362 Phase 1) onto each
      // new canon doc via traceContext, so onCanonItemWritten continues the SAME
      // import trace — the per-ingredient icon/embedding work nests under the
      // recipe import instead of N separate root traces. activeTraceparent()
      // returns undefined when no context is active (local emulators / no inbound
      // trace), and buildMatchOrCreatePorts then writes a byte-identical doc with
      // no traceContext field — degrade-never-throw (Rule 10).
      return await matchOrCreateBatch(
        inputs,
        buildMatchOrCreatePorts(batchSpan, activeTraceparent()),
      );
    } finally {
      batchSpan.end();
      // Span buffering is drained by the makeTracedCallable entrypoint's finally
      // flush (index.ts, issue #415) — either this flow's own callable, or the
      // authorRecipe / extractRecipeFromUrl callable when it runs as a nested
      // batch. The single, uniform flush point.
    }
  },
);
