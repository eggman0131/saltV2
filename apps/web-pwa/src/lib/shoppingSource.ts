import type { ShoppingListItem } from '@salt/domain';

// Where a shopping-list item CAME FROM, in words (issue #933).
//
// Two functions used to answer this and they disagreed. `ShoppingListPage`'s
// `describeSource` said "Added manually" for a `manual` source with no
// `addedBy`; `ShoppingItemRow`'s `sourceLabel` returned `''` for the same input,
// and the row's `{#if showSource && sourceLabel(item)}` guard turned that into no
// sub-line at all. So an item added by hand by someone signed out was
// indistinguishable, in the list, from an item with no source — while the edit
// sheet said exactly what it was.
//
// `describeSource`'s answer won. Unifying on `''` would have REMOVED "Added
// manually" from the sheet, which is strictly less information: a regression
// rather than a stated delta.
//
// PARTS, NOT ONE FLAT STRING (#860): the recipe's NAME carries the tap target and
// its servings stay plain text beside it, so the two cannot be rendered as a
// single blob. The manual branch stays plain — "Added by Daniel" is a person, not
// a destination. The row uses only `text`/`name`; the sheet uses all four fields.
// That difference is about how much ROOM each surface has, not about what the
// source is, which is why one function serves both.
//
// Presentation over a domain entity, so `src/lib` rather than `@salt/domain`:
// the wording, the `(N servings)` suffix and the link are rendering choices.

export type SourceParts =
  | { kind: 'manual'; text: string }
  | { kind: 'recipe'; recipeId: string; name: string; servings: string };

export function describeSource(src: ShoppingListItem['sources'][number]): SourceParts {
  if (src.kind === 'manual')
    return { kind: 'manual', text: src.addedBy ? `Added by ${src.addedBy}` : 'Added manually' };
  return {
    kind: 'recipe',
    recipeId: src.recipeId,
    name: src.label ?? 'Recipe',
    servings: `(${src.servings} serving${src.servings === 1 ? '' : 's'})`,
  };
}
