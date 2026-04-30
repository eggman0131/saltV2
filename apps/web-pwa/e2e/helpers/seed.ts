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

export async function clearAllStores(page: Page): Promise<void> {
  await page.evaluate(() => window.__e2e!.clearStores());
}
