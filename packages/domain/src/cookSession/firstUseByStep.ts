import type { IngredientDoc, IngredientGroupDoc } from '../schemas/index.js';

// Group ingredients by the step they are FIRST needed in. The recipe stamps
// `firstUsedInStepId` on each ingredient at authoring/import time, so a guided
// step can surface exactly the items it introduces inline — no scrolling back to
// mise mid-cook.
//
// Ingredients with a null `firstUsedInStepId` (never referenced by a step) are
// omitted entirely — they belong to mise en place only. Ordering within a step
// follows the recipe's own group/item order, which is the order the cook reads
// them in on the mise list.
export function firstUseByStep(
  ingredientGroups: readonly IngredientGroupDoc[],
): Map<string, IngredientDoc[]> {
  const map = new Map<string, IngredientDoc[]>();
  for (const group of ingredientGroups) {
    for (const item of group.items) {
      const stepId = item.firstUsedInStepId;
      if (!stepId) continue;
      const list = map.get(stepId);
      if (list) list.push(item);
      else map.set(stepId, [item]);
    }
  }
  return map;
}
