import type { Recipe } from '../entities/Recipe.js';
import type { Ingredient, IngredientGroup } from '../entities/Ingredient.js';
import type { Step } from '../entities/Step.js';

// Pure constructors for the recipe entity graph. They establish the invariants —
// `rawText` preserved, `parsed`/`canonId` null until later phases, `matchState`
// 'pending', `schemaVersion` 1 — so callers (the service, tests) never hand-roll
// a partial entity. `updatedAt` is left blank until the service stamps it on save.

// A blank recipe: no ingredients, no steps, empty metadata.
export function emptyRecipe(id: string, now: string): Recipe {
  return {
    id,
    schemaVersion: 1,
    title: '',
    description: null,
    ingredients: [],
    steps: [],
    metadata: {
      servings: null,
      totalTimeMinutes: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    image: null,
    createdAt: now,
    updatedAt: '',
  };
}

// An empty ingredient group. `name` null is the default/unnamed group.
export function emptyIngredientGroup(id: string, name: string | null = null): IngredientGroup {
  return { id, name, items: [] };
}

// A fresh ingredient from a raw line. Unparsed and unmatched until later phases;
// `rawText` is the sacred original.
export function newIngredient(id: string, rawText: string, isOptional = false): Ingredient {
  return {
    id,
    rawText,
    parsed: null,
    canonId: null,
    matchState: 'pending',
    isOptional,
    firstUsedInStepId: null,
  };
}

// A fresh step with no timer and no note.
export function newStep(id: string, text: string): Step {
  return { id, text, timer: null, note: null };
}
