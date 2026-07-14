import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { matchOrCreateBatch, resolveProductForm } from '@salt/domain';
import type { MatchOrCreateInput, MatchOrCreateResult, ProductForm } from '@salt/domain';
import { CanonicaliseRecipeIngredientsInputSchema } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success } from '@salt/shared-types';
import { activeTraceparent, startSpan } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { buildMatchOrCreatePorts } from './matchOrCreateCanon.js';
import { createFirestoreProductFormStore } from '../adapters/firestoreProductFormStore.js';

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
    // One parent span for the whole batch so every per-item canon span is
    // parented under a single trace. Without this the batch passes no parent to
    // buildMatchOrCreatePorts, so each item's match-log span roots its own
    // trace — N near-identical traces for one recipe.
    const batchSpan = startSpan(`canon.canonicaliseRecipeBatch: ${input.items.length} items`);
    try {
      batchSpan.setAttribute('canon.batchSize', input.items.length);
      // Stamp the browser-rooted trace (installed as the active OTel context by
      // the field-preferred callable entrypoint, issue #362 Phase 1) onto each
      // new canon doc via traceContext, so onCanonItemWritten continues the SAME
      // import trace — the per-ingredient icon/embedding work nests under the
      // recipe import instead of N separate root traces. activeTraceparent()
      // returns undefined when no context is active (local emulators / no inbound
      // trace), and buildMatchOrCreatePorts then writes a byte-identical doc with
      // no traceContext field — degrade-never-throw (Rule 10).
      const ports = buildMatchOrCreatePorts(batchSpan, activeTraceparent());

      // Product-form identity resolution (issue #500, Phase 2). Before matching,
      // consult the productForms table: an ingredient that names a known form
      // (e.g. "lime juice") binds to the form's EXISTING parent canon (the buyable
      // "lime") instead of matching/creating an orphan non-buyable canon item, so
      // it inherits the parent's aisle/icon. Best-effort: a productForms read
      // failure degrades to plain matching (Rule 10) — forms stays [].
      const formsResult = await createFirestoreProductFormStore(getFirestore()).list();
      const forms: readonly ProductForm[] = formsResult.kind === 'ok' ? formsResult.value : [];

      const results: (ReadResult<MatchOrCreateResult, DomainError> | undefined)[] = new Array(
        input.items.length,
      );
      // Items with no form binding fall through to the normal batch matcher; their
      // original indices are tracked so results reassemble in input order.
      const toMatch: { index: number; input: MatchOrCreateInput }[] = [];

      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i]!;
        const form = forms.length > 0 ? resolveProductForm(item.rawName, forms) : null;
        if (form) {
          // Bind to the existing parent canon. Load it directly; if it's missing
          // (deleted/never created) degrade to normal matching rather than fail.
          const loaded = await ports.store.load(form.parentCanonId);
          if (loaded.kind === 'ok' && loaded.value) {
            results[i] = success({ decision: 'matched' as const, item: loaded.value });
            continue;
          }
        }
        toMatch.push({
          index: i,
          input: {
            rawName: item.rawName,
            ...(item.rawText !== undefined ? { rawText: item.rawText } : {}),
            ...(item.selectedAisleId !== undefined
              ? { selectedAisleId: item.selectedAisleId }
              : {}),
          },
        });
      }

      if (toMatch.length > 0) {
        const matched = await matchOrCreateBatch(
          toMatch.map((t) => t.input),
          ports,
        );
        toMatch.forEach((t, j) => {
          results[t.index] = matched[j]!;
        });
      }

      return results as ReadResult<MatchOrCreateResult, DomainError>[];
    } finally {
      batchSpan.end();
      // Span buffering is drained by the makeTracedCallable entrypoint's finally
      // flush (index.ts, issue #415) — either this flow's own callable, or the
      // authorRecipe / extractRecipeFromUrl callable when it runs as a nested
      // batch. The single, uniform flush point.
    }
  },
);
