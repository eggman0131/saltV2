import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  matchOrCreateBatch,
  findExactCanonMatch,
  resolveProductForm,
  findFormWithSameLabel,
  proposalRejectionReason,
} from '@salt/domain';
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

      // Loaded BEFORE the ports so the synonym guard can be handed to the matcher.
      // A name a product form already claims is a DERIVATION, and must never be
      // recorded as a synonym — i.e. as another name for its own parent. Reading
      // `forms` through the closure rather than copying it is deliberate: a form
      // minted mid-batch below protects the very next item in the same recipe.
      const ports = buildMatchOrCreatePorts(batchSpan, activeTraceparent(), {
        isDerivedName: (name) => resolveProductForm(name, forms) !== null,
      });

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

      // Buyable canon items the proposal AI may pick a parent from — a PREFERENCE
      // list, not a requirement: the model is told to reuse one of these names when
      // it fits and otherwise to name a new parent, which #505's
      // `resolveParentCanonId` then mints. Best-effort: a read failure just means an
      // empty list (see the cold-start note below).
      // ponytail: second canon list read (matchOrCreateBatch lists again); fold
      // into a shared load if recipe-import canon reads ever show up hot.
      const canonList = await ports.store.list();
      const candidates =
        canonList.kind === 'ok' ? canonList.value.map((c) => ({ id: c.id, name: c.name })) : [];
      // Read BEFORE the loop below, which now consults it. A failed read yields an
      // empty list, and an empty list makes the exact check a no-op — so the flow
      // degrades to its previous behaviour rather than to a wrong answer (Rule 10).
      const canonItems = canonList.kind === 'ok' ? canonList.value : [];

      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i]!;

        // An EXACT canon hit — the item's own name, or a stored synonym — settles
        // the ingredient before forms are considered at all. That is the one place
        // canon outranks a form, and it is narrow on purpose: stages 1 and 3 answer
        // from a string somebody wrote down, where stages 2/4/5 only score a
        // resemblance. Form-first is still right for a resemblance, because a
        // derivative barely resembles its parent ("lime zest" shares one token of
        // two with "Lime"), so a fuzzy matcher running first would swallow every
        // derivative and no form would ever be proposed.
        //
        // Without this, an approved synonym could not survive: EVERY ingredient no
        // existing form claimed went to form arbitration regardless of what the
        // canon list said, so a proposal could be minted over a curated synonym —
        // and re-minted on the next pass after the operator deleted it. Deleting an
        // over-eager form and recording a synonym is how a person corrects this
        // pipeline, and the correction has to stick. Falls through to `toMatch`
        // rather than binding here, so `matchOrCreateBatch` still owns the match and
        // its logging; this decides only that no form should be proposed.
        if (findExactCanonMatch(canonItems, item.rawName) !== null) {
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
          continue;
        }

        const form = forms.length > 0 ? resolveProductForm(item.rawName, forms) : null;
        if (form && (await bindToParent(i, form.parentCanonId))) continue;
        unresolved.push(i);
      }

      // Canon items some recipe PRODUCES — the "buy or make" set.
      // An ingredient naming one of these must never become a product form; see
      // `proposalRejectionReason`. Read as a PROJECTION of a single field so the
      // recipe bodies (the largest documents in the app) never cross the wire for
      // this. Best-effort like every other read here: a failure leaves the list
      // empty, which disables the rule and restores today's behaviour rather than
      // failing the batch (Rule 10).
      const producedCanonNames = await (async (): Promise<string[]> => {
        try {
          const byId = new Map(candidates.map((c) => [c.id, c.name]));
          const snapshot = await getFirestore()
            .collection('recipes')
            .select('producesCanonId')
            .get();
          return snapshot.docs
            .map((d) => byId.get(String(d.get('producesCanonId') ?? '')))
            .filter((name): name is string => name !== undefined);
        } catch (err) {
          logger.warn('canonicaliseRecipeIngredients: produced-canon read failed', { err });
          return [];
        }
      })();

      // Fire proposals concurrently. Each is best-effort and NEVER throws (Rule 10):
      // a stall/malformed answer degrades to `{ kind: 'none' }` → normal matching.
      const proposeForm = async (i: number): Promise<ProductFormProposal> => {
        const item = input.items[i]!;
        try {
          // No outer withAiTimeout: the flow owns its budget (issue #915).
          return await arbitrateProductFormFlow({
            ingredientName: item.rawName,
            ...(item.rawText !== undefined ? { rawText: item.rawText } : {}),
            candidates,
          });
        } catch (err) {
          logger.warn('arbitrateProductForm: proposal failed, skipping', { err });
          return { kind: 'none' };
        }
      };
      // Arbitration runs regardless of how big the catalog is — INCLUDING an empty
      // one (issue #512). The old `candidates.length > 0` gate dated from when a
      // proposal could only bind to a pre-existing buyable canon; since #505 the
      // parent is named by the model and minted through matchOrCreateBatch, so a
      // cold canon is a legitimate input, not a reason to skip. With the gate in
      // place the first recipe imported into an empty canon turned every derivative
      // ("lemon juice", "egg yolk") into an orphan canon item and #505's parent
      // minting could never fire in the greenfield case it exists for. Both halves
      // already handle the empty list: the prompt renders the catalog as "(none)"
      // and tells the model to name a new parent, and `decideProductFormProposal`
      // gates on `modifier_kind`, never on catalog membership.
      const proposals = await Promise.all(unresolved.map((i) => proposeForm(i)));

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
        // already covers this proposal — never create a duplicate. TWO checks,
        // because each sees a duplicate the other structurally cannot (#854):
        //   • matcher containment answers a proposal NARROWER than a stored
        //     phrase — the original check, unchanged;
        //   • normalised-label equality answers a proposal BROADER than one, the
        //     shape actually observed in production. A "Lime juice" proposal
        //     carrying matcher "juice" resolves to nothing against a form whose
        //     matchers are ["lime juice","fresh lime juice"], so a second
        //     identically-labelled form on the same parent was minted — which is
        //     why hand-correcting a form's matchers never survived the next
        //     recipe that mentioned juice.
        // Checked by label rather than by parent because the parent is not known
        // yet: `resolveParentCanonId` below MINTS canon as a side effect, so
        // resolving it early to compare would create a canon item only to discard
        // it.
        if (proposal.kind === 'form') {
          // Two proposals are coherent but must never be minted — a form naming
          // its own parent, and a form for something a recipe already PRODUCES.
          // See `proposalRejectionReason` for why each is wrong; both fall
          // through to normal matching, which is the correct outcome (the
          // ingredient binds to its own canon and "buy or make" takes it from
          // there).
          const rejection = proposalRejectionReason(proposal, producedCanonNames);
          if (rejection !== null) {
            logger.info('arbitrateProductForm: proposal rejected', {
              reason: rejection,
              label: proposal.label,
              parentName: proposal.parentName,
            });
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
            continue;
          }

          const covering =
            resolveProductForm(proposal.matcher, forms) ??
            findFormWithSameLabel(proposal.label, forms);
          // Already covered: bind to what exists instead of minting beside it. A
          // parent that no longer loads degrades to normal matching (Rule 10),
          // exactly as every other bind here does.
          if (covering) {
            if (await bindToParent(i, covering.parentCanonId)) continue;
          } else {
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
                // No icon yet (issue #871). Stated rather than omitted: this is a
                // full-document write, and null is what onProductFormWritten's edge
                // guard reads on the create to start generating. An AI-seeded form
                // gets its pictogram on the same terms as an admin-created one —
                // pending review has never gated what a form can do.
                thumbnail: null,
              };
              // Best-effort write; on failure we simply fall through to matching.
              const written = await productFormStore.upsert(created);
              if (written.kind === 'ok') {
                forms.push(created);
                if (await bindToParent(i, parentCanonId)) continue;
              }
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
