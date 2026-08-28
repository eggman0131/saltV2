// scripts/backfill-recipe-kit.mjs's `--redo` has to DELETE `kitInferredAt`, not
// merely bump the nonce beside it (issue #954 phase 3). The reopened issue's
// finding was that the script as written re-infers nothing: `kitNeedsInference`
// returns false on its first line whenever the stamp is present, so every write
// the script made against an already-inferred recipe was a trigger invocation
// that declined.
//
// Over REST a delete is expressed as "in the updateMask, absent from the body",
// so the two halves cannot be read independently — which is what these tests
// pin. A regression here is silent in exactly the way the original defect was:
// the writes all succeed, the script reports a clean sweep, and nothing is
// re-inferred.

import { describe, it, expect } from 'vitest';

import { planKitRequest } from '../lib/recipeKitRequest.mjs';

const NOW = 1_700_000_000_000;

describe('planKitRequest', () => {
  it('an ordinary pass touches the nonce and nothing else', () => {
    const plan = planKitRequest(NOW, false);
    expect(plan.fieldPaths).toEqual(['kitRequestedAt']);
    expect(plan.fields).toEqual({ kitRequestedAt: { integerValue: String(NOW) } });
  });

  it('--redo puts kitInferredAt in the mask so Firestore deletes it', () => {
    const plan = planKitRequest(NOW, true);
    expect(plan.fieldPaths).toContain('kitInferredAt');
  });

  it('--redo leaves kitInferredAt OUT of the body — mask-without-body is the delete', () => {
    const plan = planKitRequest(NOW, true);
    // The half that is easy to lose: adding the path to the mask and then also
    // writing a value would REPLACE the stamp rather than remove it, and the
    // guard's first line would decline all over again.
    expect(plan.fields).not.toHaveProperty('kitInferredAt');
    expect(Object.keys(plan.fields)).toEqual(['kitRequestedAt']);
  });

  it('--redo still bumps the nonce, so an already-unstamped recipe is not a no-op write', () => {
    // Deleting an absent field changes nothing, Firestore emits no write event
    // for a no-op update, and the trigger would never see the request. This is
    // redoRecipeKit's second half and it matters most for the recipe whose FIRST
    // inference failed — the one a redo exists to rescue.
    const plan = planKitRequest(NOW, true);
    expect(plan.fields.kitRequestedAt).toEqual({ integerValue: String(NOW) });
    expect(plan.fieldPaths).toContain('kitRequestedAt');
  });

  it('the nonce is a string-encoded integer, as the REST encoding requires', () => {
    expect(typeof planKitRequest(NOW, false).fields.kitRequestedAt.integerValue).toBe('string');
  });
});
