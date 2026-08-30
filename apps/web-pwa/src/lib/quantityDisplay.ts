// How a QUANTITY reads, in one place (issue #933) — the sibling of
// `durationDisplay.ts`, and it exists for the same reason: three surfaces had
// their own copy of a five-character formatter, and one of them had quietly
// drifted.
//
// NOTHING HERE COMPUTES ANYTHING. That is not a style preference, it is the
// invariant the retired copies broke. `routes/batches/batchDisplay.ts` and
// `RecipeBakeBatchSheet.svelte` both said `${grams} g`; `FormulaPage.svelte` said
// `${roundGrams(grams)} g`. So the same float rendered `1234.56 g` on two screens
// and `1235 g` on a third, and nothing failed.
//
// The fix is NOT an option flag — a `{ round }` parameter on a formatter this
// small is the same fork with a longer signature. Rounding is the domain's job
// and it has exactly one authority for it (`roundGrams`,
// `packages/domain/src/formula/rounding.ts`), so the screen that wants a rounded
// figure rounds at the CALL, where it can be seen:
//
//   formatGrams(roundGrams(asWrittenDoughGrams))
//
// which is also the shape every other gram on those screens already had — the
// batch totals arrive pre-rounded from the freeze, which is why their copies
// never needed it.

/** A gram figure, already rounded by whoever decided what the number is. */
export function formatGrams(grams: number): string {
  return `${grams} g`;
}
