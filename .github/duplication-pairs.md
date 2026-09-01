# Policy-twin register

The semantic half of `weekly-duplication-sweep.yml`. Every entry here is a pair
(or small family) of files suspected of stating the **same rule in different
words** — the one class of duplication no token-level tool can see, because two
prompts stating contradictory policies share no substring.

The reference failure is **#785**: `CONVERSION_RULES` was metric-and-British-
spelling and extraction-only, while the librarian prompt preserved tsp/tbsp/cup
and alone split combined ingredient lines. Two policies, both live, quietly
disagreeing. jscpd scores that pair at zero.

## How this file is used

The sweep does **not** search. Each run takes a **two-entry slice** of this
register, chosen by run number modulo the entry count, and spends its turns
reading only those. That is what keeps a semantic sweep from becoming a
token-eating monster: every week is O(1) regardless of how large the repo gets,
and the whole register comes round every few weeks with no state file anywhere.

For each entry in the slice, the agent answers #906's three questions:

1. Do these express the same rule, policy, geometry or shape?
2. If so, does anything **force** them to agree — a shared constant, a shared
   helper, a test that would fail?
3. **Do they already disagree?** That is the difference between a latent risk
   and a live bug, and it belongs in every finding.

Deliberately parallel code with a shared source of truth is fine and is not a
finding. Copies that exist with nothing forcing agreement are.

## Maintaining it

Add an entry when you notice two places that must stay in step and nothing makes
them. Remove one when the rule gets a single owner — a shared constant or helper
— because at that point the pair is answered and re-reading it every few weeks is
waste. Keep it around a dozen entries: the register is a rotation, so every entry
added dilutes the rest.

Every path below is checked by `scripts/tests/duplicationPairs.test.mjs`, which
runs in `pnpm test` and therefore in CI. A renamed or deleted file fails that
test rather than quietly turning an entry into one the sweep reads and finds
nothing in — an entry pointing at a file that no longer exists would report
"no duplication here" every time it came round, which is the #911 failure in
miniature.

---

## 1. The two cook pages

**Files:** `apps/web-pwa/src/routes/recipes/CookModePage.svelte` ↔ `apps/web-pwa/src/routes/recipes/GuidedCookPage.svelte`

Compare step-advance, timer wiring, deck geometry, keyboard handling and session
lifecycle. #1036 made guided cook compose cook mode and removed 2,101 lines, so
much of the old copy-paste is gone — the question now is whether the _policies_
that survived on both sides still agree.

## 2. The two deck abstractions

**Files:** `apps/web-pwa/src/lib/deck.svelte.ts` ↔ `apps/web-pwa/src/lib/cookDeck.ts`

One abstraction split in two, or two that overlap? Compare geometry and
transition rules, not names.

## 3. The icon-prompt family

**Files:** `apps/cloud-functions/src/flows/equipmentIconPrompt.ts` ↔ `apps/cloud-functions/src/flows/kitchenToolIconPrompt.ts` ↔ `apps/cloud-functions/src/flows/weatherIconPrompt.ts`

Compare the _prompt policies_, not the strings: style anchors, framing rules,
what each forbids. #887 found two readers for one kill switch in this family.

## 4. The image generators

**Files:** `apps/cloud-functions/src/flows/generateCanonIcon.ts` ↔ `apps/cloud-functions/src/flows/generateEquipmentIcon.ts` ↔ `apps/cloud-functions/src/flows/generateKitchenToolIcon.ts` ↔ `apps/cloud-functions/src/flows/generateRecipeImage.ts` ↔ `apps/cloud-functions/src/callables/drawEquipmentIcon.ts`

Compare model selection, timeout, storage path, retry, kill-switch reading and
framing normalisation. Note that `generateEquipmentIcon` ↔
`generateKitchenToolIcon` already score 1.00 in the rename layer, so the
interesting question here is the other three.

## 5. The recipe-authoring prompts

**Files:** `apps/cloud-functions/src/flows/authorRecipe.ts` ↔ `apps/cloud-functions/src/flows/extractRecipeFromUrl.ts` ↔ `apps/cloud-functions/src/flows/extractRecipeFromPhoto.ts` ↔ `apps/cloud-functions/src/flows/assembleRecipeDraft.ts` ↔ `apps/cloud-functions/src/flows/recipeFieldRules.ts`

**This is where #785 happened.** Has a third policy appeared since it was
unified? Compare unit handling, spelling convention, and which prompt is allowed
to split a combined ingredient line.

## 6. The two "written" triggers

**Files:** `apps/cloud-functions/src/triggers/onKitchenToolWritten.ts` ↔ `apps/cloud-functions/src/triggers/onProductFormWritten.ts`

Mechanically corroborated — jscpd finds real clones here. The semantic question
is whether the debounce, the skip conditions and the write-back shape agree.

## 7. Canon matching across the callable boundary

**Files:** `packages/adapters/firebase-sync/src/canonMatching.ts` ↔ `packages/adapters/firebase-sync/src/recipeCallables.ts`

## 8. The two settings syncs

**Files:** `packages/adapters/firebase-sync/src/appSettingsSync.ts` ↔ `packages/adapters/firebase-sync/src/devSettingsSync.ts`

These score 1.00 in the rename layer. The question the rename layer cannot
answer is whether they are _supposed_ to be identical — one shape applied to two
documents is fine; two independently maintained copies of a defaulting policy is
not.

## 9. Component context and recipe text

**Files:** `apps/cloud-functions/src/flows/componentContext.ts` ↔ `apps/cloud-functions/src/flows/recipeText.ts`

Both render a recipe into prose for a model. Do they agree on what is included,
what is rounded, and how ingredients are phrased?

## 10. The timer triggers

**Files:** `apps/cloud-functions/src/triggers/onCookTimerWrite.ts` ↔ `apps/cloud-functions/src/triggers/onKitchenTimerWrite.ts` ↔ `apps/cloud-functions/src/triggers/onCookTimerDispatch.ts` ↔ `apps/cloud-functions/src/triggers/onKitchenTimerDispatch.ts` ↔ `apps/cloud-functions/src/triggers/onBatchStageDispatch.ts`

Three timer families with one delivery story between them. Compare retention,
retry, the TTL field written, and what each does when a subscription is stale.

## 11. Week maths, client and server

**Files:** `apps/web-pwa/src/lib/mealPlanService.ts` ↔ `packages/domain/src/mealPlan/queries/weekdays.ts` ↔ `packages/domain/src/mealPlan/commands/instantiateWeek.ts` ↔ `packages/domain/src/personalView/upcomingChefDays.ts`

**#906's highest-value target: the same rule living on both sides of a layer
boundary**, where no other review lens reads both. `firstDayOfWeek` is `"fri"` in
production, which is exactly the kind of configured constant that gets
re-derived rather than imported. Check that every place deciding "which week is
this date in" goes through the same one.
