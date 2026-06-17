/// <reference path="../../src/lib/types/e2e.d.ts" />
import type { Page } from '@playwright/test';
import type { Aisle, CanonItem } from '@salt/domain';

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
