import type { IngredientGroup } from './Ingredient.js';
import type { Step } from './Step.js';

// Seam for the deferred AI epic. `source` distinguishes AI-generated from
// user-uploaded so the gen trigger never clobbers a manual photo.
export interface RecipeImage {
  readonly url: string;
  readonly source: 'ai' | 'upload';
}

// Free-form numeric metadata. Every field is `number | null`: null means "not
// recorded", which is a valid authored state, not a missing value.
export interface RecipeMetadata {
  readonly servings: number | null;
  readonly totalTimeMinutes: number | null;
  readonly prepTimeMinutes: number | null;
  readonly cookTimeMinutes: number | null;
  readonly tags: readonly string[];
}

// Provenance of the recipe. Only `manual` is produced in this epic; `url`/`book`
// are reserved seams for the deferred URL/photo import epic (no migration needed
// when they arrive).
export interface RecipeSource {
  readonly type: 'url' | 'book' | 'manual';
  readonly url?: string;
  readonly book?: {
    readonly title: string;
    readonly author: string;
    readonly page: number;
  };
}

// One Firestore document at `recipes/{id}`. Whole-document last-write-wins on
// `updatedAt` (Firestore-as-master; no tombstones, no revision counter).
export interface Recipe {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly title: string;
  readonly description: string | null;
  readonly ingredients: readonly IngredientGroup[];
  readonly steps: readonly Step[];
  readonly metadata: RecipeMetadata;
  // null until a non-manual source is recorded (URL/photo import epic).
  readonly source: RecipeSource | null;
  // User-authored, never parsed or canonicalised.
  readonly notes: string | null;
  // Seam only in this epic. AI generation + upload CF callable land in the AI epic.
  readonly image: RecipeImage | null;
  readonly createdAt: string; // ISO-8601
  readonly updatedAt: string; // ISO-8601; stamped by the service on save
}
