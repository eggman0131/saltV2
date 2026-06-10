/**
 * Emulator integration test for firestore.rules — members allowlist (issue #155).
 *
 * Proves the real (server-side) enforcement that the client admin gating only
 * mirrors cosmetically:
 *   - any signed-in user may READ the roster
 *   - only an admin member may WRITE (create/update/delete) members
 *   - a non-admin member is denied writes even though the client UI is bypassed
 *   - an unauthenticated caller is denied reads
 *
 * Admin-ness is resolved by the rules via get(/members/$(token.email)), so the
 * caller's token email must equal an admin member doc id.
 *
 * Requires the Firestore emulator. Mirrors storageRules.emulator.test.ts: the
 * reachability probe is timer-bounded (WSL2 free-port contract, #79) and the
 * suite SKIPS when the emulator is not up.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-salt';
const HOST = '127.0.0.1';
const PORT = Number(
  (import.meta as { env?: Record<string, string | undefined> }).env?.[
    'VITE_EMULATOR_FIRESTORE_PORT'
  ] ?? '8080',
);

const RULES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../firestore.rules');

async function firestoreEmulatorReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const resp = await fetch(`http://${HOST}:${PORT}/`, { signal: controller.signal });
    return resp.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function memberDoc(email: string, admin: boolean) {
  return {
    id: email,
    schemaVersion: 1,
    name: email.split('@')[0],
    email,
    admin,
    sortOrder: 0,
    icon: null,
    updatedAt: '2026-06-07T00:00:00.000Z',
  };
}

const reachable = await firestoreEmulatorReachable();
if (!reachable) {
  console.warn(
    `[firestoreRules.emulator] Firestore emulator not reachable on ${HOST}:${PORT} — skipping.`,
  );
}

describe.skipIf(!reachable)('firestore.rules — members allowlist', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: HOST,
        port: PORT,
        rules: readFileSync(RULES_PATH, 'utf8'),
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seed the roster with the Admin SDK (rules disabled): one admin, one not.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'members', 'admin@e.org'), memberDoc('admin@e.org', true));
      await setDoc(doc(db, 'members', 'kid@e.org'), memberDoc('kid@e.org', false));
    });
  });

  function adminCtx() {
    return testEnv.authenticatedContext('uid-admin', { email: 'admin@e.org' });
  }
  function kidCtx() {
    return testEnv.authenticatedContext('uid-kid', { email: 'kid@e.org' });
  }

  it('lets an admin create a new member', async () => {
    const db = adminCtx().firestore();
    await assertSucceeds(setDoc(doc(db, 'members', 'new@e.org'), memberDoc('new@e.org', false)));
  });

  it('lets an admin update and delete members', async () => {
    const db = adminCtx().firestore();
    await assertSucceeds(setDoc(doc(db, 'members', 'kid@e.org'), memberDoc('kid@e.org', true)));
    await assertSucceeds(deleteDoc(doc(db, 'members', 'kid@e.org')));
  });

  it('lets a non-admin member read the roster', async () => {
    const db = kidCtx().firestore();
    await assertSucceeds(getDoc(doc(db, 'members', 'admin@e.org')));
  });

  it('denies a non-admin member from creating a member', async () => {
    const db = kidCtx().firestore();
    await assertFails(setDoc(doc(db, 'members', 'sneak@e.org'), memberDoc('sneak@e.org', true)));
  });

  it('denies a non-admin member from editing or deleting a member', async () => {
    const db = kidCtx().firestore();
    await assertFails(setDoc(doc(db, 'members', 'admin@e.org'), memberDoc('admin@e.org', false)));
    await assertFails(deleteDoc(doc(db, 'members', 'admin@e.org')));
  });

  it('denies an unauthenticated caller from reading the roster', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'members', 'admin@e.org')));
  });

  it('denies a signed-in user whose email is not a member', async () => {
    const db = testEnv.authenticatedContext('uid-ghost', { email: 'ghost@e.org' }).firestore();
    // can read (any signed-in user) but cannot write (not an admin member)
    await assertSucceeds(getDoc(doc(db, 'members', 'admin@e.org')));
    await assertFails(setDoc(doc(db, 'members', 'x@e.org'), memberDoc('x@e.org', false)));
  });
});

describe.skipIf(!reachable)('firestore.rules — meal planning (issue #169)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: HOST,
        port: PORT,
        rules: readFileSync(RULES_PATH, 'utf8'),
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  function userCtx() {
    // Any signed-in user is already an allowlisted member; no member doc needed
    // because meal-plan rules never call get(/members/...) (writes are open).
    return testEnv.authenticatedContext('uid-user', { email: 'user@e.org' }).firestore();
  }

  it('lets any signed-in user read and write the config singleton', async () => {
    const db = userCtx();
    await assertSucceeds(
      setDoc(doc(db, 'mealPlanConfig', 'singleton'), { firstDayOfWeek: 'mon', schemaVersion: 1 }),
    );
    await assertSucceeds(getDoc(doc(db, 'mealPlanConfig', 'singleton')));
  });

  it('lets any signed-in user read and write the template singleton', async () => {
    const db = userCtx();
    await assertSucceeds(
      setDoc(doc(db, 'mealPlanTemplate', 'singleton'), { schemaVersion: 1, days: {} }),
    );
    await assertSucceeds(getDoc(doc(db, 'mealPlanTemplate', 'singleton')));
  });

  it('lets any signed-in user read and write a week doc', async () => {
    const db = userCtx();
    await assertSucceeds(
      setDoc(doc(db, 'mealPlans', '2026-06-08'), {
        id: '2026-06-08',
        schemaVersion: 1,
        startDate: '2026-06-08',
        days: {},
        updatedAt: '2026-06-08T00:00:00.000Z',
      }),
    );
    await assertSucceeds(getDoc(doc(db, 'mealPlans', '2026-06-08')));
  });

  it('denies an unauthenticated caller on every meal-plan doc', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'mealPlanConfig', 'singleton')));
    await assertFails(getDoc(doc(db, 'mealPlanTemplate', 'singleton')));
    await assertFails(getDoc(doc(db, 'mealPlans', '2026-06-08')));
  });
});
