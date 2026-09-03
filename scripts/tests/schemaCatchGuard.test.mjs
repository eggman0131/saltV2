/**
 * Where `.catch()` is allowed to live under `packages/domain/src/schemas/`
 * (issue #1114).
 *
 * `.catch()` is strictly stronger than `.default()`: it swallows an absent
 * field, a null, a wrong type and an unknown enum member alike, so the field it
 * guards cannot be rejected for any reason. On a schema that parses a stored
 * Firestore document that is not a convenience, it is the skip-and-log contract
 * switched off — #1114's whole subject. `ShoppingListItemSchema.matchState`
 * carried one, and the browser and `onShoppingListItemWrite` disagreed about
 * what state a document was in for as long as it did.
 *
 * ── Why this is an ALLOWLIST and not "returns nothing" ─────────────────────
 *
 * #1114's Definition of Done states the check as `grep -rn '\.catch(' …`
 * returning NOTHING, on the strength of that grep having returned exactly one
 * line when the issue was written. It no longer does:
 * `AuthoredRecipePhasesSchema` in `recipe.ts` grew a deliberate `.catch([])`
 * afterwards (#1122 review, blocking 3), it guards an AI OUTPUT rather than a
 * stored document, and `recipe.ts` was on #1114's must-not-touch list. Shipping
 * the unqualified absolute anyway — in a comment, a DoD tick or a test name —
 * is precisely the defect class CLAUDE.md Rule 12 exists for, so the claim is
 * made with its real boundary instead: one known instance, named here with its
 * reason, and any second one reds.
 *
 * ── Why EQUALITY, not `<=` ─────────────────────────────────────────────────
 *
 * Both directions matter, the same argument `coverage.areas.mjs` and
 * `unit-test-spec.areas.mjs` make. Going UP is the rot this exists to stop: a
 * `.catch()` copied onto another Firestore document schema is #1114 happening
 * again on a different collection. Going DOWN without editing the list means
 * the guard has stopped guarding — if `recipe.ts`'s instance were removed or
 * merely reworded out of detection, an allowlist that only permits would sit
 * green over a matcher that matches nothing.
 *
 * ── Honest limits ──────────────────────────────────────────────────────────
 *
 * It reads source TEXT. It sees `.catch(` written literally and would miss one
 * reached through a variable, built by a helper, or composed from outside this
 * directory — and it says nothing about schemas anywhere else in the repo.
 * Comments are stripped, so a file may DISCUSS `.catch()` without tripping it,
 * which both `shoppingListItem.ts` and `recipe.ts` now do; a guard a comment can
 * trip is one an author silences by rewording.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The sanctioned instances: file → why it is there. */
const ALLOWED = new Map([
  ['recipe.ts', 'AuthoredRecipePhasesSchema — an AI output, not a stored document (#1122)'],
]);

const schemaDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'domain',
  'src',
  'schemas',
);

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const files = readdirSync(schemaDir).filter((f) => f.endsWith('.ts'));
const withCatch = files.filter((f) =>
  stripComments(readFileSync(join(schemaDir, f), 'utf8')).includes('.catch('),
);

describe('.catch() under packages/domain/src/schemas', () => {
  it('reads a real, non-empty set of schema files', () => {
    // Anti-vacuity: a guard over zero files passes for the wrong reason.
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('shoppingListItem.ts');
    expect(files).toContain('recipe.ts');
  });

  it('finds exactly the sanctioned instances, and no others', () => {
    // Equality both ways — see the header. The message names the reason so a
    // reader of a red run knows whether to fix the code or edit ALLOWED.
    expect(withCatch).toEqual([...ALLOWED.keys()]);
  });

  it('has none on either shopping schema — the narrowing #1114 shipped', () => {
    expect(withCatch).not.toContain('shoppingListItem.ts');
    expect(withCatch).not.toContain('shoppingList.ts');
  });
});
