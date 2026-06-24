/**
 * Canon real-time match via the onShoppingListItemWrite trigger (E2E).
 *
 * This spec closes the gap the shopping-list happy-path spec deliberately
 * leaves open. That spec only asserts the *canonical substring* of a matched
 * item's rendered text, because "asserting the full raw string races the
 * trigger" — the trigger rewrites `rawText` once it fires, so a DOM assertion
 * on the original raw entry is non-deterministic.
 *
 * Here we assert the FULL post-trigger matched state deterministically by
 * polling the store snapshot (window.__e2e.getShoppingListItems()) until the
 * trigger has run, then asserting every field it rewrites:
 *   - canonId      → the seeded canon item's id
 *   - matchState   → 'matched'
 *   - rawText      → the trigger-cleaned name ('cheddar cheese')
 *   - amount/unit  → the parsed quantity (2 / 'tins')
 *   - notes        → '' (no trailing "for …" context in the entry)
 *
 * Determinism (no AI): the trigger's matchOrCreate pipeline auto-matches at
 * stage 1 (exact normalised-name equality, confidence 1.0) WITHOUT touching
 * embeddings or AI arbitration. The seeded canon name and the shopping entry's
 * parsed name both normalise to "cheddar cheese", so the match is a stage-1
 * direct hit — fully deterministic and AI-free. See
 * packages/domain/src/canon/queries/findClosestMatch.ts (stage 1) and
 * packages/domain/src/canon/commands/matchOrCreate.ts (direct_match → no AI).
 *
 * The rawText rewrite is deterministic too: parseShoppingListEntry strips the
 * trailing whitelisted unit ("2 tins") into amount/unit and leaves the clean
 * name "cheddar cheese"; the trigger rewrites rawText to that clean name only
 * because notes are empty (see onShoppingListItemWrite.ts: the rewrite is gated
 * on `nameChanged && currentNotes === ''`).
 *
 * Requirements:
 *   - Firestore + Auth emulators running (started by playwright.config.ts)
 *   - The onShoppingListItemWrite CF trigger running in the Functions emulator
 *     (it runs in-band; we poll the item's store snapshot until it fires).
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail, waitForBridge } from './helpers/auth';
import { getShoppingListItems, seedAisles, seedCanonItem } from './helpers/seed';
// TRIGGER_TIMEOUT bounds the in-band Functions-emulator trigger, which is still
// an async round-trip (write → trigger → match → write-back → onSnapshot).
import { SYNC_TIMEOUT, TRIGGER_TIMEOUT } from './helpers/timeouts';

test.describe('canon real-time match — onShoppingListItemWrite trigger', () => {
  test('pending item is matched + rewritten by the trigger (full state asserted)', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const email = uniqueEmail(testInfo.testId);
    await gotoAndSignIn(page, email);

    // ── Seed an aisle + a canon item whose name the entry will match exactly ──
    // "Cheddar Cheese" normalises to "cheddar cheese"; the entry "cheddar
    // cheese 2 tins" parses to name "cheddar cheese" → identical normalised
    // form → stage-1 exact match, no AI. The aisle lets the matched item route
    // out of "Other" into its aisle, giving us a DOM signal in addition to the
    // store-snapshot assertion.
    await page.goto('/');
    await waitForBridge(page);

    const [dairyAisle] = await seedAisles(page, ['Dairy']);
    const cheddarCanon = await seedCanonItem(page, {
      name: 'Cheddar Cheese',
      aisleId: dairyAisle!.id,
    });
    expect(cheddarCanon.id).toBeTruthy();

    // ── Create a shopping list ───────────────────────────────────────────────
    await page.goto('/#/shopping');
    await expect(page).toHaveURL(/#\/shopping\/new/, { timeout: 10_000 });
    await page.getByTestId('shopping-create-list-name').fill('Weekly shop');
    await page.getByRole('button', { name: /create/i }).click();
    await expect(page).toHaveURL(/#\/shopping\/[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
    await expect(page.getByTestId('shopping-list-page')).toBeVisible();

    // ── Add the item — enters as matchState 'pending', canonId null ──────────
    const rawEntry = 'cheddar cheese 2 tins';
    await page.getByTestId('shopping-item-input').fill(rawEntry);
    await page.getByTestId('shopping-item-add-btn').click();

    // It should appear immediately in "Other" (pending), before the trigger.
    const other = page.getByTestId('shopping-other');
    await expect(other).toBeVisible({ timeout: SYNC_TIMEOUT });
    await expect(other.getByText(/cheddar cheese/i)).toBeVisible({ timeout: SYNC_TIMEOUT });

    // ── Poll the store snapshot until the trigger has matched the item ───────
    // Assert the OBSERVABLE store state, not implementation. The trigger flips
    // matchState pending → matched and rewrites the doc; we wait for that.
    await expect
      .poll(
        async () => {
          const items = await getShoppingListItems(page);
          return items.find((i) => i.canonId === cheddarCanon.id)?.matchState ?? null;
        },
        { timeout: TRIGGER_TIMEOUT },
      )
      .toBe('matched');

    // ── Assert the FULL post-trigger matched state deterministically ─────────
    const items = await getShoppingListItems(page);
    const matched = items.find((i) => i.canonId === cheddarCanon.id);
    expect(matched, 'matched item should be present in the store').toBeTruthy();

    // canonId + matchState: the core gap this spec closes.
    expect(matched!.canonId).toBe(cheddarCanon.id);
    expect(matched!.matchState).toBe('matched');

    // rawText: the trigger rewrote the raw entry to the clean parsed name.
    // The happy-path spec deliberately could not assert this (it races the
    // trigger); here we assert the post-trigger value precisely.
    expect(matched!.rawText).toBe('cheddar cheese');

    // amount / unit: lifted out of the raw entry by the deterministic parser.
    expect(matched!.amount).toBe(2);
    expect(matched!.unit).toBe('tins');

    // notes: the entry had no trailing "for …" context, so notes stay empty.
    expect(matched!.notes).toBe('');

    // NOTE on the DOM: we deliberately do NOT assert which rendered row/aisle
    // bucket the matched item lands in. Once matched, the row's grouping and
    // display label are owned by the page's *local* canon snapshot (canonMap /
    // liveCanonIds in ShoppingListPage.svelte). Whether the seeded canon has
    // propagated into that local snapshot at the instant the trigger's write-back
    // re-renders the list is a cross-context canon-sync race — the item can
    // momentarily render in no visible bucket. That timing is exactly the flake
    // source this suite's predecessor specs warn about (#199), and it is NOT the
    // trigger behaviour under test. The store snapshot above is the deterministic,
    // observable proof of the trigger's full match + rewrite; we assert that and
    // its persistence, not the transient grouping.

    // ── Persistence: the rewritten state survives a reload ───────────────────
    const currentUrl = page.url();
    await page.reload();
    await page.goto(currentUrl);
    await expect(page.getByTestId('shopping-list-page')).toBeVisible({ timeout: SYNC_TIMEOUT });

    await expect
      .poll(
        async () => {
          const reloaded = await getShoppingListItems(page);
          const m = reloaded.find((i) => i.canonId === cheddarCanon.id);
          return m ? { rawText: m.rawText, matchState: m.matchState, amount: m.amount } : null;
        },
        { timeout: SYNC_TIMEOUT },
      )
      .toEqual({ rawText: 'cheddar cheese', matchState: 'matched', amount: 2 });
  });
});
