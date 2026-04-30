/// <reference path="../../src/lib/types/e2e.d.ts" />
import type { Page } from '@playwright/test';

export function uniqueEmail(testId: string): string {
  return `e2e-${testId}@salt.test`;
}

async function waitForBridge(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__e2e), null, { timeout: 10_000 });
}

export async function signIn(page: Page, email: string): Promise<void> {
  await waitForBridge(page);
  await page.evaluate((e) => window.__e2e!.devSignIn(e), email);
}

export async function gotoAndSignIn(page: Page, email: string, path = '/'): Promise<void> {
  await page.goto(path);
  await signIn(page, email);
}
