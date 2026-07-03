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
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

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

describe.skipIf(!reachable)('firestore.rules — devSettings (issue #238)', () => {
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
    // devSettings writes are admin-gated via get(/members/...), so seed a roster.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'members', 'admin@e.org'), memberDoc('admin@e.org', true));
      await setDoc(doc(db, 'members', 'kid@e.org'), memberDoc('kid@e.org', false));
    });
  });

  const settings = { canonIconGenerationEnabled: false, schemaVersion: 1 };

  it('lets an admin write the settings singleton', async () => {
    const db = testEnv.authenticatedContext('uid-admin', { email: 'admin@e.org' }).firestore();
    await assertSucceeds(setDoc(doc(db, 'devSettings', 'singleton'), settings));
  });

  it('lets any signed-in user read the settings singleton', async () => {
    const db = testEnv.authenticatedContext('uid-kid', { email: 'kid@e.org' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'devSettings', 'singleton')));
  });

  it('denies a non-admin member from writing the settings', async () => {
    const db = testEnv.authenticatedContext('uid-kid', { email: 'kid@e.org' }).firestore();
    await assertFails(setDoc(doc(db, 'devSettings', 'singleton'), settings));
  });

  it('denies an unauthenticated caller from reading the settings', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'devSettings', 'singleton')));
  });
});

describe.skipIf(!reachable)('firestore.rules — weatherForecast (issue #382)', () => {
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
    // The cache is written by the refreshWeatherForecast CF (Admin SDK, bypasses
    // rules); seed one with rules disabled so the read assertions have a doc.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'weatherForecast', 'singleton'), forecast);
    });
  });

  const forecast = {
    days: {},
    fetchedAt: 0,
    location: { latitude: 51.5085, longitude: -0.1257, timezone: 'Europe/London', label: 'Home' },
    timezone: 'Europe/London',
  };

  it('lets any signed-in user read the forecast singleton', async () => {
    const db = testEnv.authenticatedContext('uid-kid', { email: 'kid@e.org' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'weatherForecast', 'singleton')));
  });

  it('denies a signed-in client from writing the forecast directly', async () => {
    // Clients only ever trigger a refresh via the callable; the doc is written by
    // the CF Admin SDK, so direct client writes (even by an admin) are closed.
    const db = testEnv.authenticatedContext('uid-admin', { email: 'admin@e.org' }).firestore();
    await assertFails(setDoc(doc(db, 'weatherForecast', 'singleton'), forecast));
  });

  it('denies an unauthenticated caller from reading the forecast', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'weatherForecast', 'singleton')));
  });
});

describe.skipIf(!reachable)('firestore.rules — notes collection removed (issue #408)', () => {
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

  // The old `notes` rule allowed unauthenticated reads (`allow read: if true`).
  // The block was deleted, so `notes` now falls through to the terminal
  // default-deny — no caller (authed or not) may read or write it.
  it('denies an unauthenticated caller from reading notes', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'notes', 'n1')));
  });

  it('denies a signed-in user from reading or writing notes', async () => {
    const db = testEnv.authenticatedContext('uid-user', { email: 'user@e.org' }).firestore();
    await assertFails(getDoc(doc(db, 'notes', 'n1')));
    await assertFails(setDoc(doc(db, 'notes', 'n1'), { text: 'hi' }));
  });
});

describe.skipIf(!reachable)('firestore.rules — chatSessions ownerUid (issue #206, #408)', () => {
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

  const session = (ownerUid: string) => ({
    ownerUid,
    title: 'Chat',
    schemaVersion: 1,
    updatedAt: '2026-07-03T00:00:00.000Z',
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seed a session owned by uid-a with rules disabled.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'chatSessions', 's1'), session('uid-a'));
    });
  });

  function ownerDb() {
    return testEnv.authenticatedContext('uid-a', { email: 'a@e.org' }).firestore();
  }
  function otherDb() {
    return testEnv.authenticatedContext('uid-b', { email: 'b@e.org' }).firestore();
  }

  it('lets the owner create a session with their own uid', async () => {
    const db = ownerDb();
    await assertSucceeds(setDoc(doc(db, 'chatSessions', 's2'), session('uid-a')));
  });

  it('denies creating a session owned by someone else', async () => {
    const db = ownerDb();
    await assertFails(setDoc(doc(db, 'chatSessions', 's3'), session('uid-b')));
  });

  it('lets the owner read, update (keeping ownerUid), and delete their session', async () => {
    const db = ownerDb();
    await assertSucceeds(getDoc(doc(db, 'chatSessions', 's1')));
    await assertSucceeds(updateDoc(doc(db, 'chatSessions', 's1'), { title: 'Renamed' }));
    await assertSucceeds(deleteDoc(doc(db, 'chatSessions', 's1')));
  });

  // The core #408 fix: an owner must not be able to reassign ownerUid, which
  // would plant a session in another user's list.
  it('denies the owner reassigning ownerUid to another user', async () => {
    const db = ownerDb();
    await assertFails(updateDoc(doc(db, 'chatSessions', 's1'), { ownerUid: 'uid-b' }));
  });

  it("denies a non-owner from reading or writing another user's session", async () => {
    const db = otherDb();
    await assertFails(getDoc(doc(db, 'chatSessions', 's1')));
    await assertFails(updateDoc(doc(db, 'chatSessions', 's1'), { title: 'hijack' }));
    await assertFails(deleteDoc(doc(db, 'chatSessions', 's1')));
  });

  it('denies an unauthenticated caller on chatSessions', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'chatSessions', 's1')));
  });
});
