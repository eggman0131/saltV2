/// <reference path="../../src/lib/types/e2e.d.ts" />
import type { Page } from '@playwright/test';

export function uniqueEmail(testId: string): string {
  return `e2e-${testId}@salt.test`;
}

// The beforeMemberCreated Auth blocking function (issue #155) rejects account
// creation for any email not present in the `members` allowlist. The e2e
// Functions emulator loads that function, so a test user must be on the
// allowlist before sign-in or the account is never created. We seed the member
// directly into the Firestore emulator via its owner REST endpoint (which
// bypasses security rules — the equivalent of an admin having pre-added them),
// using the same host/port globalSetup.ts targets for the test stack.
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8081';
const EMULATOR_PROJECT = 'demo-salt';

async function seedMemberAllowlist(email: string, admin = false): Promise<void> {
  const id = email.trim().toLowerCase(); // matches normaliseMemberEmail / the blocking-fn lookup
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${EMULATOR_PROJECT}/databases/(default)/documents/` +
    `members/${encodeURIComponent(id)}`;
  const body = {
    fields: {
      id: { stringValue: id },
      schemaVersion: { integerValue: '1' },
      name: { stringValue: id.split('@')[0] },
      email: { stringValue: id },
      admin: { booleanValue: admin },
      sortOrder: { integerValue: '0' },
      icon: { nullValue: null },
      updatedAt: { stringValue: new Date().toISOString() },
    },
  };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`seedMemberAllowlist failed for ${id}: HTTP ${res.status} ${await res.text()}`);
  }
}

async function waitForBridge(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__e2e), null, { timeout: 10_000 });
}

// `admin: true` seeds the allowlisted member with the admin flag, which the
// client-side AdminGuard requires to render operator-area screens (e.g. canon
// management, moved behind /admin in #157).
export async function signIn(
  page: Page,
  email: string,
  options: { admin?: boolean } = {},
): Promise<void> {
  await seedMemberAllowlist(email, options.admin ?? false);
  await waitForBridge(page);
  await page.evaluate((e) => window.__e2e!.devSignIn(e), email);
}

export async function gotoAndSignIn(
  page: Page,
  email: string,
  path = '/',
  options: { admin?: boolean } = {},
): Promise<void> {
  await page.goto(path);
  await signIn(page, email, options);
}
