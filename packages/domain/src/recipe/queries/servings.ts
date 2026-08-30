// A recipe's stated servings count when it can serve as a scaling base, and
// `null` when it cannot (issue #1123).
//
// Every scaler wrote `metadata.servings ?? 1`, which guards a MISSING count — and
// 0 is not missing. It is the one value that makes `target / base` meaningless,
// so a recipe stored at 0 scaled a shopping list by `Infinity`, or by `NaN` when
// the review sheet seeded its own stepper from that same 0. A `NaN` amount is
// then rejected by `ShoppingListItemSchema` on the way back in, so the row does
// not reappear at all — an ingredient silently absent from the list.
//
// It lives here, in the pure module, because the three places that need it — the
// plan builder, the review sheet's seed and the made-header's default — are in
// two files that must not re-derive the rule between them, and because the
// STORED schema stays permissive on purpose: `RecipeMetadataSchema` is the read
// boundary for a production collection, where rejecting a bad `servings` would
// skip the whole recipe rather than fix one field.
export function usableServings(stated: number | null): number | null {
  return stated !== null && Number.isFinite(stated) && stated > 0 ? stated : null;
}
