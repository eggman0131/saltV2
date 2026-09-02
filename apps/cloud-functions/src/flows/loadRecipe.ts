import { getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';
import { RecipeSchema, type RecipeDoc } from '@salt/domain/schemas';

// The prologue three AI flows share (issue #970): fetch one recipe by id, check
// it is there, check it is readable, and hand back the parsed document. It was
// written out three times — `generateGuidedPlan` and `extractProcessStages`
// byte-identically, `proposeSchedule` with the fetch as one leg of a Promise.all.
//
// Why the duplication mattered enough to remove. The error CODE each of these
// throws is not cosmetic: `classifyCallableError`
// (packages/adapters/firebase-sync/src/callableErrors.ts) reads it on the browser
// side and turns `not-found` and `failed-precondition` into different things the
// user is told. Three copies of a decision that reaches the user is three chances
// to answer it differently, and the fourth flow to need a recipe would have
// copied whichever of the three it happened to see.
//
// Why it lives in `flows/` and not `adapters/`. The modules under
// `src/adapters/` are stores: they return data. This one throws `HttpsError`,
// which is callable-protocol vocabulary, so it belongs beside its callers.
//
// CLAUDE.md Rule 10 ("adapters never throw for operational errors") does NOT
// apply here, and the distinction is the reason this file is where it is: an
// adapter under `packages/adapters` crosses an `@salt` boundary and owes its
// caller a `Failure<DomainError>`. This is app-level code at the callable edge,
// where `HttpsError` IS the contract the client is written against — the
// callable row of the per-boundary Zod failure table in docs/data-model.md.
//
// Rule 2 also pins it here: the Admin SDK is legitimate in `apps/cloud-functions`
// and only there, so this helper cannot be "promoted" into `@salt/domain` (pure)
// or `@salt/firebase-sync` (browser SDK, unreachable from Cloud Functions) to be
// shared more widely. Both are closed to it.
//
// A fourth hand-written copy is caught by `tests/loadRecipeGuard.test.ts`. The
// eleven other sites that read a recipe are deliberately NOT users of this
// helper — each is non-throwing on purpose (a missing recipe must not cost a
// cook-timer notification, an edit-mode author degrades to create mode, a batch
// read skips a bad document) and each is named in that guard's allowlist.

/**
 * What the client is told when the recipe id names nothing.
 *
 * Exported so the guard and the tests assert on the VALUE rather than on a
 * regex over source text (docs/unit-test-spec.md §E, UT-E1): reword the message
 * here and everything that checks it moves with it.
 */
export const RECIPE_NOT_FOUND_MESSAGE = "That recipe doesn't exist.";

/** What the client is told when the stored document fails `RecipeSchema`. */
export const RECIPE_UNREADABLE_MESSAGE = "That recipe can't be read.";

/**
 * Validate an already-fetched `recipes/{id}` snapshot, or throw.
 *
 * For a caller that fetches the recipe as part of a wider read —
 * `proposeSchedule` reads `recipes` and `formulas` in one `Promise.all`, and a
 * fetch-only helper cannot participate in that without costing a round-trip.
 *
 * @throws HttpsError `not-found` when the document does not exist.
 * @throws HttpsError `failed-precondition` when it fails `RecipeSchema`.
 */
export function requireRecipeFrom(snap: DocumentSnapshot): RecipeDoc {
  if (!snap.exists) {
    throw new HttpsError('not-found', RECIPE_NOT_FOUND_MESSAGE);
  }
  // A trust boundary (a Firestore read), so it is validated like every other.
  // `.safeParse`, never `.parse` — the failure is a user-facing message, not a
  // stack trace (CLAUDE.md, Zod schema conventions).
  const recipe = RecipeSchema.safeParse(snap.data());
  if (!recipe.success) {
    throw new HttpsError('failed-precondition', RECIPE_UNREADABLE_MESSAGE);
  }
  return recipe.data;
}

/**
 * Fetch `recipes/{recipeId}` and return it parsed, or throw.
 *
 * A plain `.get()` on the Admin SDK: no transaction, no `getAll`, no retry —
 * these flows read one document and the caller is a human with a button they
 * can press again.
 *
 * @throws HttpsError the two codes documented on {@link requireRecipeFrom}.
 */
export async function requireRecipe(recipeId: string): Promise<RecipeDoc> {
  const snap = await getFirestore().collection('recipes').doc(recipeId).get();
  return requireRecipeFrom(snap);
}
