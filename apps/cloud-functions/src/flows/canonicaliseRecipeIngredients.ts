import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { matchOrCreateBatch, resolveProductForm } from '@salt/domain';
import type { MatchOrCreateInput, MatchOrCreateResult, ProductForm } from '@salt/domain';
import {
  CanonicaliseRecipeIngredientsInputSchema,
  type ProductFormProposal,
} from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success } from '@salt/shared-types';
import { activeTraceparent, startSpan } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { buildMatchOrCreatePorts } from './matchOrCreateCanon.js';
import { createFirestoreProductFormStore } from '../adapters/firestoreProductFormStore.js';
import { arbitrateProductFormFlow } from './arbitrateProductForm.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';

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
      const productFormStore = createFirestoreProductFormStore(getFirestore());
      const formsResult = await productFormStore.list();
      // Mutable: AI-seeded proposals written mid-batch (below) are pushed here so a
      // second occurrence of the same derivative in the SAME recipe resolves via
      // the just-written form (and its idempotency check) without a second AI call.
      const forms: ProductForm[] = formsResult.kind === 'ok' ? [...formsResult.value] : [];

      const results: (ReadResult<MatchOrCreateResult, DomainError> | undefined)[] = new Array(
        input.items.length,
      );
      // Items with no form binding fall through to the normal batch matcher; their
      // original indices are tracked so results reassemble in input order.
      const toMatch: { index: number; input: MatchOrCreateInput }[] = [];

      const bindToParent = async (i: number, parentCanonId: string): Promise<boolean> => {
        // Bind to the existing parent canon. Load it directly; if it's missing
        // (deleted/never created) degrade to normal matching rather than fail.
        const loaded = await ports.store.load(parentCanonId);
        if (loaded.kind === 'ok' && loaded.value) {
          results[i] = success({ decision: 'matched' as const, item: loaded.value });
          return true;
        }
        return false;
      };

      // Items that don't resolve to an existing form are candidates for an
      // AI-seeded product-form PROPOSAL (issue #500, Phase 3): the model decides
      // whether the ingredient is a non-buyable form of a known buyable canon item
      // and, if so, the parent + suggested yield. Collected here so the AI calls
      // fire concurrently (one round-trip of wall time, not N) before we apply them
      // deterministically in input order.
      const unresolved: number[] = [];

      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i]!;
        const form = forms.length > 0 ? resolveProductForm(item.rawName, forms) : null;
        if (form && (await bindToParent(i, form.parentCanonId))) continue;
        unresolved.push(i);
      }

      // Buyable canon items the proposal AI may pick a parent from. Best-effort: a
      // read failure (or an empty catalog) simply means no proposals this batch.
      // ponytail: second canon list read (matchOrCreateBatch lists again); fold
      // into a shared load if recipe-import canon reads ever show up hot.
      const canonList = await ports.store.list();
      const candidates =
        canonList.kind === 'ok' ? canonList.value.map((c) => ({ id: c.id, name: c.name })) : [];

      // Fire proposals concurrently. Each is best-effort and NEVER throws (Rule 10):
      // a stall/malformed answer degrades to `{ kind: 'none' }` → normal matching.
      const proposeForm = async (i: number): Promise<ProductFormProposal> => {
        const item = input.items[i]!;
        try {
          return await withAiTimeout('arbitrateProductForm', () =>
            arbitrateProductFormFlow({
              ingredientName: item.rawName,
              ...(item.rawText !== undefined ? { rawText: item.rawText } : {}),
              candidates,
            }),
          );
        } catch (err) {
          logger.warn('arbitrateProductForm: proposal failed, skipping', { err });
          return { kind: 'none' };
        }
      };
      const proposals =
        candidates.length > 0
          ? await Promise.all(unresolved.map((i) => proposeForm(i)))
          : unresolved.map(() => ({ kind: 'none' }) as ProductFormProposal);

      // In-batch dedupe: mint each named parent through matchOrCreateBatch at most
      // ONCE per recipe. Two forms naming the same parent (e.g. "lime juice" +
      // "lime zest" → "Lime") reuse the id, so only one "Lime" canon is created.
      // Keyed on the normalised (trim + lowercase) parent name. matchOrCreateBatch
      // reuses an existing canon ("Lime" already present) or mints a needs_approval
      // one (with aisle/icon/embedding) — never a hand-rolled canon write. A
      // resolution failure returns null → the derivative degrades to normal
      // matching (Rule 10).
      const parentIdByName = new Map<string, string>();
      const resolveParentCanonId = async (parentName: string): Promise<string | null> => {
        const key = parentName.trim().toLowerCase();
        const cached = parentIdByName.get(key);
        if (cached !== undefined) return cached;
        const [res] = await matchOrCreateBatch([{ rawName: parentName }], ports);
        if (res && res.kind === 'ok') {
          parentIdByName.set(key, res.value.item.id);
          return res.value.item.id;
        }
        return null;
      };

      // Apply proposals in input order so in-batch idempotency is deterministic.
      for (let u = 0; u < unresolved.length; u++) {
        const i = unresolved[u]!;
        const item = input.items[i]!;
        const proposal = proposals[u]!;

        // A prior in-batch write may now cover this ingredient — re-resolve first.
        const nowForm = resolveProductForm(item.rawName, forms);
        if (nowForm && (await bindToParent(i, nowForm.parentCanonId))) continue;

        // Idempotency: skip if any existing/in-batch form (pending or confirmed)
        // already covers the proposed matcher — never create a duplicate.
        if (proposal.kind === 'form' && resolveProductForm(proposal.matcher, forms) === null) {
          // Resolve the named parent to a canon id (reuse existing / mint new). A
          // null result (resolution failed) degrades to normal matching (Rule 10).
          const parentCanonId = await resolveParentCanonId(proposal.parentName);
          if (parentCanonId) {
            const created: ProductForm = {
              id: crypto.randomUUID(),
              schemaVersion: 1,
              matchers: [proposal.matcher],
              parentCanonId,
              label: proposal.label,
              yield: { formUnit: proposal.formUnit, amountPerParent: proposal.amountPerParent },
              // Written pending: used live immediately, but flagged for admin review.
              needs_approval: true,
              updatedAt: new Date().toISOString(),
            };
            // Best-effort write; on failure we simply fall through to matching.
            const written = await productFormStore.upsert(created);
            if (written.kind === 'ok') {
              forms.push(created);
              if (await bindToParent(i, parentCanonId)) continue;
            }
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
