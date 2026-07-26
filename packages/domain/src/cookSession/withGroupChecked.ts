import type { CookSessionDoc, IngredientGroupDoc } from '../schemas/index.js';

// Bulk tick / untick ONE mise-en-place group ("For the sauce"). A sectioned recipe
// is worked through a section at a time — everything for the sauce comes out of the
// cupboard together — and for that the whole-recipe `withAllIngredientsChecked` is
// too blunt: it would tick the pasta and the garnish too.
//
// SET semantics, deliberately not the whole-list replacement its sibling does: the
// OTHER sections' ticks have to survive, so this only ever adds or removes this
// group's own ids. Ticked ids stay in tick order (the group's land at the end), and
// re-ticking a group can't duplicate an id.
//
// `checked` is the TARGET state rather than a toggle, because the caller already
// derives "is this whole section ticked?" for its button label — and that is a
// question about the RECIPE, not about the session, which can carry ids for
// ingredients since edited out.
export function withGroupChecked(
  session: CookSessionDoc,
  group: IngredientGroupDoc,
  checked: boolean,
): CookSessionDoc {
  const groupIds = new Set(group.items.map((item) => item.id));
  const others = session.checkedIngredientIds.filter((id) => !groupIds.has(id));
  return { ...session, checkedIngredientIds: checked ? [...others, ...groupIds] : others };
}
