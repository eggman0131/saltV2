/**
 * Emulator integration test for firestore.rules — members allowlist (issue #155).
 *
 * Proves the real (server-side) enforcement that the client admin gating only
 * mirrors cosmetically:
 *   - any signed-in user may READ the roster
 *   - only an admin member may WRITE (create/update/delete) members
 *   - a non-admin member is denied writes even though the client UI is bypassed
 *   - an unauthenticated caller is denied reads
 *   - EXCEPT: a member may update their own `cookMode` and nothing else (#776),
 *     which is the one place a non-admin may write this collection at all
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
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

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

function memberDoc(email: string, admin: boolean, over: Record<string, unknown> = {}) {
  return {
    id: email,
    schemaVersion: 1,
    name: email.split('@')[0],
    email,
    admin,
    sortOrder: 0,
    icon: null,
    cookMode: 'standard',
    updatedAt: '2026-06-07T00:00:00.000Z',
    ...over,
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

  // ─── The self-serve cook-mode exception (issue #776) ───────────────────────
  //
  // A member may update their OWN doc, but only to change `cookMode`. This doc
  // carries the `admin` flag, so the denials below are the point of the feature's
  // security review — the permitted case is one line and the ways to abuse it are
  // the rest. Everything here runs as `kid`, a NON-admin.

  it('lets a member set their own cook mode', async () => {
    const db = kidCtx().firestore();
    await assertSucceeds(
      setDoc(
        doc(db, 'members', 'kid@e.org'),
        memberDoc('kid@e.org', false, { cookMode: 'guided' }),
      ),
    );
  });

  it('lets a member set it back', async () => {
    const db = kidCtx().firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'members', 'kid@e.org'), { cookMode: 'guided', updatedAt: 'x' }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'members', 'kid@e.org'), { cookMode: 'standard', updatedAt: 'y' }),
    );
  });

  it('DENIES making yourself an admin while changing your cook mode', async () => {
    // The attack the pinning exists for. Both fields move in one write, which is
    // exactly what an attacker would send.
    const db = kidCtx().firestore();
    await assertFails(
      setDoc(doc(db, 'members', 'kid@e.org'), memberDoc('kid@e.org', true, { cookMode: 'guided' })),
    );
  });

  it('DENIES making yourself an admin on its own', async () => {
    const db = kidCtx().firestore();
    await assertFails(updateDoc(doc(db, 'members', 'kid@e.org'), { admin: true }));
  });

  it('DENIES changing anything else about yourself', async () => {
    // Not a security hole so much as a scope one: the exception is for a cooking
    // preference, and a member editing their own name or sort order is the admin
    // screen's job.
    const db = kidCtx().firestore();
    await assertFails(updateDoc(doc(db, 'members', 'kid@e.org'), { name: 'Renamed' }));
    await assertFails(updateDoc(doc(db, 'members', 'kid@e.org'), { sortOrder: 99 }));
    await assertFails(updateDoc(doc(db, 'members', 'kid@e.org'), { email: 'other@e.org' }));
  });

  it("DENIES setting someone ELSE's cook mode", async () => {
    const db = kidCtx().firestore();
    await assertFails(
      updateDoc(doc(db, 'members', 'admin@e.org'), { cookMode: 'guided', updatedAt: 'x' }),
    );
  });

  it('DENIES a cook mode that is not one of the two the schema allows', async () => {
    // The doc is family-readable, so an unconstrained string here is a place to
    // park arbitrary data on someone else's screen.
    const db = kidCtx().firestore();
    await assertFails(
      updateDoc(doc(db, 'members', 'kid@e.org'), { cookMode: 'anything', updatedAt: 'x' }),
    );
  });

  it('DENIES creating or deleting your own member doc', async () => {
    // The exception is an UPDATE exception. A member who could delete themselves
    // could then be re-created by the blocking function with a fresh doc.
    const db = kidCtx().firestore();
    await assertFails(deleteDoc(doc(db, 'members', 'kid@e.org')));
    await assertFails(
      setDoc(
        doc(db, 'members', 'kid2@e.org'),
        memberDoc('kid2@e.org', false, { cookMode: 'guided' }),
      ),
    );
  });

  it('lets a member on a doc written before `icon` existed still set their cook mode', async () => {
    // `icon` carries `.default(null)`, so the oldest member docs have no such key.
    // A rule that pinned fields by comparing them one by one would read a missing
    // key here and deny — working everywhere except on the longest-standing
    // accounts, which is precisely the failure that ships green.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const { icon: _icon, cookMode: _cookMode, ...legacy } = memberDoc('old@e.org', false);
      await setDoc(doc(db, 'members', 'old@e.org'), legacy);
    });
    const db = testEnv.authenticatedContext('uid-old', { email: 'old@e.org' }).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'members', 'old@e.org'), { cookMode: 'guided', updatedAt: 'x' }),
    );
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

describe.skipIf(!reachable)('firestore.rules — canonEmbeddings server-only (issue #410)', () => {
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
    // Vectors are written by the CF match path (Admin SDK, bypasses rules); seed
    // one with rules disabled so the read-deny assertion has a doc to be denied.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'canonEmbeddings', 'c1'), { embedding: [0.1, 0.2] });
    });
  });

  // The whole point of #410: the collection is server-only. Unlike canonItems
  // (open read/write to any signed-in user), NO client — signed-in or not — may
  // read or write canonEmbeddings, so the browser never syncs vectors it never
  // uses. The CF match path reaches it via the Admin SDK, which bypasses rules.
  it('denies a signed-in user from reading a canonEmbeddings doc', async () => {
    const db = testEnv.authenticatedContext('uid-user', { email: 'user@e.org' }).firestore();
    await assertFails(getDoc(doc(db, 'canonEmbeddings', 'c1')));
  });

  it('denies a signed-in user from writing a canonEmbeddings doc', async () => {
    const db = testEnv.authenticatedContext('uid-user', { email: 'user@e.org' }).firestore();
    await assertFails(setDoc(doc(db, 'canonEmbeddings', 'c2'), { embedding: [0.3] }));
  });

  it('denies an unauthenticated caller on canonEmbeddings', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'canonEmbeddings', 'c1')));
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

// cookSessions is the second (and only other) owner-scoped collection in an
// otherwise entirely family-shared data model, and its rule is the ONLY thing
// stopping one household member from reading another's in-progress cook. The
// cook-mode e2e only ever runs as a single user, so it exercises the permit side
// and never the deny side — that is the gap these cover (issue #558).
//
// The deterministic id (`${recipeId}_${uid}`) is a convention, not an
// enforcement: the rules never parse the id, so every assertion here is about
// the `ownerUid` FIELD. A doc id that embeds another user's uid buys no access,
// and one that embeds your own buys none either if the field disagrees.
describe.skipIf(!reachable)('firestore.rules — cookSessions ownerUid (issue #558)', () => {
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

  const session = (ownerUid: string, recipeId = 'recipe-1') => ({
    id: `${recipeId}_${ownerUid}`,
    schemaVersion: 1,
    ownerUid,
    recipeId,
    recipeUpdatedAtAtStart: '2026-07-24T00:00:00.000Z',
    checkedIngredientIds: [],
    completedStepIds: [],
    activeTimers: [],
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  });

  // uid-a's in-progress cook of recipe-1, seeded with rules disabled.
  const A_SESSION = 'recipe-1_uid-a';

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'cookSessions', A_SESSION), session('uid-a'));
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
    await assertSucceeds(
      setDoc(doc(db, 'cookSessions', 'recipe-2_uid-a'), session('uid-a', 'recipe-2')),
    );
  });

  it('denies creating a session owned by someone else', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, 'cookSessions', 'recipe-2_uid-b'), session('uid-b', 'recipe-2')),
    );
  });

  it('lets the owner read, update (keeping ownerUid), and delete their session', async () => {
    const db = ownerDb();
    await assertSucceeds(getDoc(doc(db, 'cookSessions', A_SESSION)));
    await assertSucceeds(
      updateDoc(doc(db, 'cookSessions', A_SESSION), { checkedIngredientIds: ['ing-1'] }),
    );
    await assertSucceeds(deleteDoc(doc(db, 'cookSessions', A_SESSION)));
  });

  // The owner must not be able to reassign ownerUid, which would plant a cook
  // session in another user's list (the chatSessions #408 fix, mirrored here).
  it('denies the owner reassigning ownerUid to another user', async () => {
    const db = ownerDb();
    await assertFails(updateDoc(doc(db, 'cookSessions', A_SESSION), { ownerUid: 'uid-b' }));
  });

  // The load-bearing assertion: a signed-in household member is NOT entitled to
  // another member's cook session just by being signed in, unlike every
  // family-shared collection in the app.
  it("denies a non-owner from reading, updating or deleting another user's session", async () => {
    const db = otherDb();
    await assertFails(getDoc(doc(db, 'cookSessions', A_SESSION)));
    await assertFails(updateDoc(doc(db, 'cookSessions', A_SESSION), { checkedIngredientIds: [] }));
    await assertFails(deleteDoc(doc(db, 'cookSessions', A_SESSION)));
  });

  // A non-owner cannot take the doc over by overwriting it either: setDoc on an
  // existing doc is an update, so the pinned-ownerUid clause rejects it whether
  // the payload claims uid-a (fails the existing-owner check) or uid-b (fails
  // the pin). Without this, "read is denied" would still leave a clobber open.
  it("denies a non-owner from overwriting another user's session wholesale", async () => {
    const db = otherDb();
    await assertFails(setDoc(doc(db, 'cookSessions', A_SESSION), session('uid-b')));
    await assertFails(setDoc(doc(db, 'cookSessions', A_SESSION), session('uid-a')));
  });

  // The `resource == null` clause (#558). The cook page subscribes to the
  // deterministic id BEFORE bootstrapping the session, so a signed-in user must
  // be able to read an id that holds nothing yet — without this the listener is
  // denied and torn down permanently on every first cook. Absence carries no
  // data, so this grants no access to anyone's session.
  it('lets a signed-in user read a session id that does not exist yet', async () => {
    await assertSucceeds(getDoc(doc(ownerDb(), 'cookSessions', 'recipe-9_uid-a')));
    // Including one keyed to another user — there is nothing there to read, and
    // the moment uid-b creates it the deny assertions above take over.
    await assertSucceeds(getDoc(doc(otherDb(), 'cookSessions', 'recipe-9_uid-a')));
  });

  // Same clause on delete: the deleted-recipe orphan cleanup fires
  // removeCookSession for an id that may never have been created.
  it('lets a signed-in user delete a session id that does not exist yet', async () => {
    await assertSucceeds(deleteDoc(doc(ownerDb(), 'cookSessions', 'recipe-9_uid-a')));
  });

  it('denies an unauthenticated caller on cookSessions', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'cookSessions', A_SESSION)));
    await assertFails(setDoc(doc(db, 'cookSessions', 'recipe-3_anon'), session('uid-a')));
    // The absent-doc allowance is scoped to signed-in callers, not everyone.
    await assertFails(getDoc(doc(db, 'cookSessions', 'recipe-9_uid-a')));
  });
});

describe.skipIf(!reachable)('firestore.rules — shoppingDays (issue #629)', () => {
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

  const SHOP_DATE = '2026-08-15';
  const shopDay = (setBy: string) => ({
    date: SHOP_DATE,
    slot: 'am',
    schemaVersion: 1,
    setBy,
    setAt: '2026-08-10T09:00:00.000Z',
  });

  function userCtx(uid: string) {
    return testEnv.authenticatedContext(uid, { email: `${uid}@e.org` }).firestore();
  }

  it('lets any signed-in user mark, read and clear a shop day', async () => {
    const db = userCtx('uid-a');
    await assertSucceeds(setDoc(doc(db, 'shoppingDays', SHOP_DATE), shopDay('uid-a')));
    await assertSucceeds(getDoc(doc(db, 'shoppingDays', SHOP_DATE)));
    await assertSucceeds(deleteDoc(doc(db, 'shoppingDays', SHOP_DATE)));
  });

  // The load-bearing difference from the three owner-scoped collections: when the
  // household shops is FAMILY-SHARED, and `setBy` is an audit field that is
  // deliberately NOT pinned — either of them may reschedule the other's shop.
  it('lets another member move a shop day someone else set', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'shoppingDays', SHOP_DATE), shopDay('uid-a'));
    });
    const db = userCtx('uid-b');
    await assertSucceeds(setDoc(doc(db, 'shoppingDays', SHOP_DATE), shopDay('uid-b')));
    await assertSucceeds(deleteDoc(doc(db, 'shoppingDays', SHOP_DATE)));
  });

  // The planner reads a week as a range over doc ids, so the collection itself
  // must be listable by a signed-in member.
  it('lets a signed-in user read the collection', async () => {
    const db = userCtx('uid-a');
    await assertSucceeds(getDocs(collection(db, 'shoppingDays')));
  });

  it('denies an unauthenticated caller entirely', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'shoppingDays', SHOP_DATE)));
    await assertFails(getDocs(collection(db, 'shoppingDays')));
    await assertFails(setDoc(doc(db, 'shoppingDays', SHOP_DATE), shopDay('anon')));
    await assertFails(deleteDoc(doc(db, 'shoppingDays', SHOP_DATE)));
  });
});

describe.skipIf(!reachable)('firestore.rules — guidedPlans (issue #751)', () => {
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

  const PLAN_RECIPE = 'recipe-1';
  const plan = () => ({
    id: PLAN_RECIPE,
    schemaVersion: 1,
    recipeId: PLAN_RECIPE,
    recipeUpdatedAtAtSave: '2026-08-01T09:00:00.000Z',
    prep: [{ id: 'prep-1', text: 'Dice the onion', container: 'bowl', ingredientIds: ['ing-1'] }],
    stepNotes: [],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  });

  function userCtx(uid: string) {
    return testEnv.authenticatedContext(uid, { email: `${uid}@e.org` }).firestore();
  }

  it('lets any signed-in user write, read and clear a plan', async () => {
    const db = userCtx('uid-a');
    await assertSucceeds(setDoc(doc(db, 'guidedPlans', PLAN_RECIPE), plan()));
    await assertSucceeds(getDoc(doc(db, 'guidedPlans', PLAN_RECIPE)));
    await assertSucceeds(deleteDoc(doc(db, 'guidedPlans', PLAN_RECIPE)));
  });

  // The load-bearing property: a plan is FAMILY-SHARED, like the recipe it
  // describes, and carries no ownerUid. Either member may re-run or hand-correct
  // the other's plan — this is deliberately NOT a fourth per-user collection.
  it('lets another member overwrite a plan someone else wrote', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'guidedPlans', PLAN_RECIPE), plan());
    });
    const db = userCtx('uid-b');
    await assertSucceeds(setDoc(doc(db, 'guidedPlans', PLAN_RECIPE), plan()));
    await assertSucceeds(getDoc(doc(db, 'guidedPlans', PLAN_RECIPE)));
  });

  // The deterministic id means the editor subscribes to the plan for a recipe that
  // has none. Unlike cookSessions this needs no `resource == null` clause — the
  // rule never dereferences resource.data — but the BEHAVIOUR is what matters, so
  // it is pinned here rather than assumed.
  it('lets a signed-in user read a plan id that does not exist yet', async () => {
    await assertSucceeds(getDoc(doc(userCtx('uid-a'), 'guidedPlans', 'recipe-never-planned')));
  });

  it('denies an unauthenticated caller entirely', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'guidedPlans', PLAN_RECIPE)));
    await assertFails(getDocs(collection(db, 'guidedPlans')));
    await assertFails(setDoc(doc(db, 'guidedPlans', PLAN_RECIPE), plan()));
    await assertFails(deleteDoc(doc(db, 'guidedPlans', PLAN_RECIPE)));
  });
});
