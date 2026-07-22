/// <reference path="../../src/lib/types/e2e.d.ts" />
import type { Page } from '@playwright/test';
import type { Aisle, CanonItem, Recipe, ShoppingListItem } from '@salt/domain';

export interface SeedCanonItemInput {
  readonly id?: string;
  readonly name: string;
  readonly aisleId?: string | null;
  readonly synonyms?: readonly string[];
  readonly thumbnail?: string | null;
  readonly embedding?: readonly number[] | null;
  readonly needs_approval?: boolean;
}

export async function seedAisles(page: Page, names: readonly string[]): Promise<readonly Aisle[]> {
  return page.evaluate((ns) => window.__e2e!.seedAisles(ns), names);
}

export async function seedCanonItem(page: Page, input: SeedCanonItemInput): Promise<CanonItem> {
  return page.evaluate((i) => window.__e2e!.seedCanonItem(i), input);
}

// Writes a whole recipe document through the real `persistRecipe` path (NF-C4).
// The recipe editor is the right seam for specs about authoring; this one is for
// specs that need a recipe shaped in ways the editor cannot produce — notably
// `firstUsedInStepId`, stamped by the AI author flow and left null by the UI, so
// a UI-authored recipe shows no per-step first-use ingredients at all.
export async function seedRecipe(page: Page, recipe: Recipe): Promise<void> {
  await page.evaluate((r) => window.__e2e!.seedRecipe(r), recipe);
}

export async function getAisles(page: Page): Promise<readonly Aisle[]> {
  return page.evaluate(() => window.__e2e!.getAisles());
}

export async function getCanonItem(page: Page, id: string): Promise<CanonItem | null> {
  return page.evaluate((i) => window.__e2e!.getCanonItem(i), id);
}

// Wait until a tab's canon sync has attached and delivered its first snapshot.
// Cross-tab convergence tests call this on the reader tab before the writer
// seeds: it ensures the reader's onSnapshot listeners settle in a calm window
// rather than mid-navigation, where the emulator's forced long-polling
// transport can drop the update (residual flake, #199).
export async function waitForCanonReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__e2e?.isCanonSynced() === true, null, {
    timeout: 15_000,
  });
}

export async function clearAllStores(page: Page): Promise<void> {
  await page.evaluate(() => window.__e2e!.clearStores());
}

// Snapshot of the active shopping list's items straight from the store —
// the observable post-trigger state (canonId, matchState, rawText, amount,
// unit, notes). Used to assert the onShoppingListItemWrite trigger's rewrite
// deterministically, without racing the DOM.
export async function getShoppingListItems(page: Page): Promise<readonly ShoppingListItem[]> {
  return page.evaluate(() => window.__e2e!.getShoppingListItems());
}
