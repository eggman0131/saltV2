import type {
  LibrarianOutput,
  RecipeDoc,
  RecipeSourceDoc,
  IngredientGroupDoc,
  IngredientDoc,
} from '@salt/domain/schemas';
import { canonicaliseRecipeIngredientsFlow } from './canonicaliseRecipeIngredients.js';
import { parseRecipeIngredientsFlow } from './parseRecipeIngredients.js';
import { normaliseTags } from './categoryTags.js';

// The one place a RecipeDoc is assembled from raw AI output. Both authoring
// paths (the librarian chat in authorRecipe, the URL import in
// extractRecipeFromUrl) produce the same structure — step IDs, parsed ingredient
// data, canon matches, resolved first-use ordinals — and used to carry a copy of
// it each, which is how the two drifted apart in the first place.
//
// It lives in apps/cloud-functions, NOT packages/domain, because it awaits
// parseRecipeIngredientsFlow and canonicaliseRecipeIngredientsFlow: the domain
// layer is pure and does no I/O (CLAUDE.md hard rule 1).
//
// `raw` is typed as LibrarianOutput because that is the common structural shape
// of the two AI outputs — ExtractRecipeAIOutput is assignable to it (it adds
// `isRecipe` and narrows the numeric fields to non-negative ints, neither of
// which this module reads or relies on).

export interface AssembleRecipeDraftOptions {
  /** Provenance stamped on the assembled doc — `{ type: 'manual' }` for the
   *  librarian, `{ type: 'url', url }` for an import. */
  source: RecipeSourceDoc;
  /** Edit mode: the recipe being amended. Its unchanged ingredients are carried
   *  over verbatim (see baseByRawText below) and its `kind` / `producesCanonId`
   *  are preserved, so an amend can never silently re-type or unlink the entry it
   *  is editing. null / omitted = author a fresh draft. */
  baseRecipe?: RecipeDoc | null;
  /** Stamp `needs_approval: true` — raw AI output nobody has read yet (issue
   *  #616). Omitted/false leaves the field OFF the document entirely; absent
   *  means reviewed, and an explicit `false` is not the same thing. */
  needsApproval?: boolean;
  /** Derive `totalTimeMinutes` from prep + cook when the source gives only the
   *  parts. True for URL imports (pages commonly state prep and cook but no
   *  total, and a blank total in the editor reads as missing data); false for the
   *  librarian, whose totals come from a conversation that either stated one or
   *  did not. */
  deriveTotalTime?: boolean;
}

type ParsedIngredient = Awaited<
  ReturnType<typeof parseRecipeIngredientsFlow>
>[number]['items'][number]['parsed'];

type CanonResult = Awaited<ReturnType<typeof canonicaliseRecipeIngredientsFlow>>[number];

export async function assembleRecipeDraft(
  raw: LibrarianOutput,
  {
    source,
    baseRecipe = null,
    needsApproval = false,
    deriveTotalTime = false,
  }: AssembleRecipeDraftOptions,
): Promise<RecipeDoc> {
  const now = new Date().toISOString();

  // Assign stable IDs to steps first so we can resolve step ordinals → IDs.
  const steps = raw.steps.map((s) => ({
    id: crypto.randomUUID(),
    text: s.text,
    timer:
      s.timerMinutes !== null
        ? { durationMinutes: s.timerMinutes, description: s.timerLabel }
        : null,
    note: s.note,
  }));

  // Edit mode: index the base recipe's ingredients by rawText. The librarian is
  // told to keep unchanged ingredients' rawText verbatim, so a byte-identical
  // rawText means "untouched" — we reuse its existing canon match, parsed data,
  // and id, and skip it entirely from the parse + canon (embedding) flows below.
  // Only genuinely new or edited ingredients get re-parsed and re-embedded, so a
  // one-line "add cheese" edit costs one canon match instead of N.
  const baseByRawText = new Map<string, IngredientDoc>();
  if (baseRecipe) {
    for (const group of baseRecipe.ingredients) {
      for (const ing of group.items) baseByRawText.set(ing.rawText, ing);
    }
  }

  // Flatten only the ingredients that actually need processing (new/edited).
  // With no base recipe baseByRawText is empty, so this is every distinct
  // ingredient line.
  const toProcess: string[] = [];
  const seen = new Set<string>();
  for (const group of raw.ingredientGroups) {
    for (const ing of group.ingredients) {
      if (baseByRawText.has(ing.rawText) || seen.has(ing.rawText)) continue;
      seen.add(ing.rawText);
      toProcess.push(ing.rawText);
    }
  }

  // Parse raw texts to extract clean item names (strips quantity, unit, prep phrases).
  // This mirrors what recipeService.canonicaliseIngredients does on the manual-entry path
  // and ensures the canon matching stages see "garlic" not "1 head of garlic".
  // We also retain the full structured `parsed` object (quantity/unit/displayText/etc.) keyed
  // by rawText so the assembled RecipeDoc threads it through instead of dropping it as null.
  // Duplicate rawText: last occurrence wins, matching parsedItemMap's tolerated behavior.
  const parsedItemMap = new Map<string, string>();
  const parsedMap = new Map<string, ParsedIngredient>();
  if (toProcess.length > 0) {
    try {
      const joinedRawText = toProcess.join('\n');
      const parseResult = await parseRecipeIngredientsFlow({ rawText: joinedRawText });
      for (const group of parseResult) {
        for (const item of group.items) {
          if (item.parsed?.item) parsedItemMap.set(item.rawText, item.parsed.item);
          if (item.parsed) parsedMap.set(item.rawText, item.parsed);
        }
      }
    } catch {
      // Parse failure is non-fatal — fall back to rawText as rawName below
      // and to parsed: null on the assembled ingredient.
    }
  }

  // Batch canonicalise only the to-process raw texts; key results by rawText so
  // the assembly step below can look each one up directly.
  const canonByRawText = new Map<string, CanonResult>();
  if (toProcess.length > 0) {
    try {
      const canonResults = await canonicaliseRecipeIngredientsFlow({
        items: toProcess.map((rawText) => ({
          rawName: parsedItemMap.get(rawText) ?? rawText,
          rawText,
        })),
      });
      toProcess.forEach((rawText, k) => {
        const r = canonResults[k];
        if (r) canonByRawText.set(rawText, r);
      });
    } catch {
      // Canon failure is non-fatal — ingredients land as pending.
    }
  }

  // Assemble ingredient groups with IDs, canon results, and firstUsedInStepId.
  const ingredientGroups: IngredientGroupDoc[] = raw.ingredientGroups.map((group) => ({
    id: crypto.randomUUID(),
    name: group.name,
    items: group.ingredients.map((ing) => {
      // Resolve step ordinal → step ID. Always taken from the fresh AI output so
      // reordered steps / flipped optional flags are respected even on otherwise
      // unchanged ingredients.
      const ord = ing.firstUsedInStepOrdinal;
      const firstUsedInStepId =
        ord !== null && ord >= 0 && ord < steps.length ? steps[ord]!.id : null;

      // Unchanged ingredient — carry the existing canon match, parsed data, and
      // id straight over (it was never sent to parse/canon above).
      const base = baseByRawText.get(ing.rawText);
      if (base) {
        return {
          id: base.id,
          rawText: ing.rawText,
          parsed: base.parsed,
          canonId: base.canonId,
          matchState: base.matchState,
          isOptional: ing.isOptional,
          firstUsedInStepId,
        };
      }

      const canon = canonByRawText.get(ing.rawText);
      const canonId = canon && canon.kind === 'ok' ? (canon.value.item as { id: string }).id : null;
      const matchState: 'matched' | 'pending' | 'failed' =
        canon && canon.kind === 'ok' ? 'matched' : canon ? 'failed' : 'pending';

      return {
        id: crypto.randomUUID(),
        rawText: ing.rawText,
        parsed: parsedMap.get(ing.rawText) ?? null,
        canonId,
        matchState,
        isOptional: ing.isOptional,
        firstUsedInStepId,
      };
    }),
  }));

  // "No cooking" is a real answer (a salad, a dressing, a cocktail) and the
  // extractor now accepts it as `0` (issue #739). A stored recipe has only one
  // way to say "no time to state" — null — so fold 0 back to it here rather than
  // teaching every card, editor and diff to render a 0 that means "none".
  //
  // ORDER MATTERS: the total is derived from the RAW values, and only the result
  // is folded — so prep 15 + cook 0 still totals 15. Folding first would read
  // cook 0 as "not stated" and throw the total away entirely. A derived total of
  // 0 (both parts 0) folds too: a recipe that takes no time at all is the same
  // nonsense the schema rejects on the way in.
  const zeroToNull = (n: number | null): number | null => (n === 0 ? null : n);

  const derivedTotalTimeMinutes = deriveTotalTime
    ? (raw.totalTimeMinutes ??
      (raw.prepTimeMinutes !== null && raw.cookTimeMinutes !== null
        ? raw.prepTimeMinutes + raw.cookTimeMinutes
        : null))
    : raw.totalTimeMinutes;

  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    // Authoring and importing both produce a cookable recipe (issue #637) —
    // outings are written by hand and have nothing to author or extract. On an
    // edit-mode amend the base recipe's own kind is carried through instead.
    kind: baseRecipe?.kind ?? 'recipe',
    title: raw.title,
    description: raw.description,
    ingredients: ingredientGroups,
    steps,
    metadata: {
      servings: raw.servings,
      totalTimeMinutes: zeroToNull(derivedTotalTimeMinutes),
      prepTimeMinutes: zeroToNull(raw.prepTimeMinutes),
      cookTimeMinutes: zeroToNull(raw.cookTimeMinutes),
      tags: normaliseTags(raw.tags),
    },
    source,
    notes: raw.notes,
    // Preserve the existing "makes" link on an edit-mode amend; null otherwise.
    // Neither the librarian nor the extractor touches it, so carry the base value
    // straight through.
    producesCanonId: baseRecipe?.producesCanonId ?? null,
    // Same carry-through, for the same reason (issue #752): neither the librarian
    // nor the extractor knows what a meal is, so an edit-mode amend or a refresh
    // must hand the base recipe's components straight back. Without this line
    // `mergeAmendedRecipe`'s spread would erase them on every amend.
    componentRecipeIds: baseRecipe?.componentRecipeIds ?? [],
    // Third carry-through of the same shape, and the sharpest of the three
    // (issue #845). An edit-mode amend rebuilds the WHOLE document from
    // `baseRecipe` and `mergeAmendedRecipe` spreads that draft over the existing
    // recipe, so omitting these two lines would silently erase the recipe's
    // creator every time someone amended it by chat. Neither the librarian nor
    // the extractor knows who anyone is; on a create there is no one to credit
    // yet, so both go out blank and the client stamps them on save.
    createdBy: baseRecipe?.createdBy ?? '',
    lastEditedBy: baseRecipe?.lastEditedBy ?? '',
    // Spread, not `needs_approval: needsApproval` — the field is optional and
    // absent means reviewed, so the un-flagged path must omit it entirely rather
    // than write an explicit false.
    ...(needsApproval ? { needs_approval: true } : {}),
    image: null,
    createdAt: now,
    updatedAt: now,
  };
}
