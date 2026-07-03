import type {
  RecipeDoc,
  RecipeImageDoc,
  RecipeMetadataDoc,
  RecipeSourceDoc,
} from '../../schemas/recipe.js';

// The recipe entity graph (issue #179). Schema-first (issue #417): these are
// aliases of the inferred schema types from `@salt/domain/schemas` — `RecipeSchema`
// & co. are the single source of truth, so the entity and the Firestore document
// can no longer drift behind a cast. The entity aliases stay so the recipe
// module's public surface (`@salt/domain`) is unchanged.

// Seam for the deferred AI epic. `source` distinguishes AI-generated from
// user-uploaded so the gen trigger never clobbers a manual photo.
export type RecipeImage = RecipeImageDoc;

// Free-form numeric metadata. Every field is `number | null`: null means "not
// recorded", which is a valid authored state, not a missing value.
export type RecipeMetadata = RecipeMetadataDoc;

// Provenance of the recipe. Only `manual` is produced in this epic; `url`/`book`
// are reserved seams for the deferred URL/photo import epic (no migration needed
// when they arrive).
export type RecipeSource = RecipeSourceDoc;

// One Firestore document at `recipes/{id}`. Whole-document last-write-wins on
// `updatedAt` (Firestore-as-master; no tombstones, no revision counter).
export type Recipe = RecipeDoc;
