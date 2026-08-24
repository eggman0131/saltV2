/**
 * The subscription contract — every exported `subscribe*`, one table (#928).
 *
 * ─── What this file is for ───────────────────────────────────────────────────
 * #941 measured `firebase-sync` as the sharpest risk in the #913 programme:
 * worst coverage in the repo (51.3% lines), worst scaffolding ratio (15.2 lines
 * per assertion), highest duplication (62.2%), and 36% of its assertions
 * checking only that a mock was called. Three refactors land on these files
 * (#928 consolidation, #931 the writer error contract, #939 query narrowing) and
 * before this suite existed the tests would not have noticed if any of them
 * broke a subscription.
 *
 * This is the characterisation net for all three. It runs against the real
 * Firestore emulator, so it pins OBSERVABLE BEHAVIOUR — what a subscriber
 * receives — and not the shape of the code that produces it. That is the whole
 * point: a net written against mocked `onSnapshot` calls re-breaks the moment
 * the consolidation changes which module calls it, which is precisely the noise
 * that stalls a refactor.
 *
 * ─── Why a table and not 28 describe blocks ──────────────────────────────────
 * #928's finding is that these modules are one file copied 13 times. A test
 * suite that copies its body 28 times would be the same defect, one level up —
 * and would leave the next subscription uncovered by default. The table inverts
 * that: a new subscription is a row, and `covers every exported subscribe*`
 * below FAILS until the row exists. That guard is derived from the barrel, never
 * from a hand-kept list (docs/unit-test-spec.md UT-E1/UT-E2).
 *
 * ─── The two families ────────────────────────────────────────────────────────
 * Every subscription is `(...keys, onData, onError) => unsubscribe`, and splits
 * by what it delivers:
 *   • COLLECTION — an array (or a Map) of documents. A corrupt document is
 *     skipped and the valid subset is still delivered.
 *   • DOCUMENT   — one `T | null`. An absent document delivers `null`; a corrupt
 *     one is a `StorageError`/`corruption` on `onError`.
 * Those two rules are the CLAUDE.md adapter contract, and the table asserts them
 * uniformly rather than trusting 28 files to have implemented them the same way.
 *
 * ─── What pins #939 (query narrowing) ────────────────────────────────────────
 * A row that only ever seeds documents the query ADMITS pins nothing about the
 * query: delete the `where` and the row stays green. So every row that carries a
 * filter, an order or a limit also seeds what the query must LEAVE OUT, and
 * names it in `excluded`; every row with an `orderBy` seeds enough documents for
 * the delivered ORDER to be asserted as a list, not as membership. A row with no
 * such bound says so in `noExcludedCase`, and the guard block below fails a
 * bounded row that arrives without either. The bounds that exist today:
 *
 *   subscribeBatchObservations   subcollection path + orderBy('at','asc')
 *   subscribeChatSessions        where('ownerUid','==',uid)
 *   subscribeMyCookSessions      where('ownerUid') + orderBy('updatedAt','desc')
 *                                + limit(5) — all three pinned by one row
 *   subscribeShoppingDaysInRange where(documentId() >= start), where(<= end)
 *   subscribeShoppingListItems   subcollection path under one list id
 *   the six KEYED document rows  the document key itself (batch, cook session,
 *                                formula, guided plan, kitchen timers, week)
 *
 * The other 17 read a whole collection or a fixed singleton id, unfiltered and
 * unordered — there is nothing there to narrow, and their `noExcludedCase`
 * string says which of the two it is.
 *
 * ─── The corrupt-document rows assert a REJECTION, not an absence ────────────
 * Every collection parse loop `console.error`s `Document {id} failed validation`
 * before skipping. The corrupt row asserts that log, because "the valid subset
 * was delivered and 'bad' was not in it" is ALSO satisfied by a corrupt document
 * the query never surfaced — which is exactly how the first cut of
 * `subscribeBatchObservations` passed: `CORRUPT` carried no `at`, and Firestore
 * excludes a document missing the ordered field, so nothing was ever skipped.
 * The log assertion turns that silent pass into a red.
 *
 * The single-document rows need no such assertion for the `'error'` case — a
 * `StorageError`/`corruption` on `onError` cannot be produced by a document the
 * read never saw. The two `'null'` rows do assert the log, because there `null`
 * is by design indistinguishable from "absent" to the caller, and the log is the
 * only thing that says the null came from a rejection.
 *
 * ─── Seeding goes through the emulator's REST door, not a client ─────────────
 * Every row seeds with `seed()`, which writes through the Firestore emulator's
 * REST API with `Authorization: Bearer owner` — the same rules-bypassing door
 * `clearFirestoreEmulator` already uses, and the pre-boot REST seeding #721
 * established for e2e.
 *
 * This is a deliberate correction of the obvious approach (a second Firebase
 * client), which was tried first and does not work uniformly: firestore.rules
 * closes CLIENT writes to `equipmentIcons` and `weatherForecast` entirely
 * (`allow write: if false` — the Admin SDK writes them), gates `appSettings`,
 * `devSettings` and `members` behind `isAdmin()`, and requires the writer to BE
 * the owner for `chatSessions`, `cookSessions` and `kitchenTimers`. Eight of the
 * 28 could therefore never be seeded client-side, and a table with eight
 * exceptions is not a table.
 *
 * The important part is that this costs the suite nothing it needs. Reads are
 * uniformly `allow read: if request.auth != null`, so the subscriber is a normal
 * signed-in client in every row; only the seed takes the back door. What the
 * table pins is the READ contract — what a subscriber receives — and a
 * REST-written document reaches it through exactly the same `onSnapshot` path as
 * another client's write. Cross-client convergence proper, and the write path,
 * stay covered by realtimeSubscriptions.emulator.test.ts.
 *
 * Requires the isolated Vitest emulator stack; run via `pnpm test:emulator`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import type { DomainError } from '@salt/shared-types';
import * as barrel from '../src/index.js';
import { clearFirestoreEmulator, resetDefaultApp, PROJECT_ID } from './emulatorHelpers.js';

import { subscribeAisles } from '../src/aisleSubscription.js';
import { subscribeAppSettings } from '../src/appSettingsSync.js';
import { subscribeBatch, subscribeBatches } from '../src/batchSync.js';
import { subscribeBatchObservations } from '../src/batchObservationSync.js';
import { subscribeCanonItems } from '../src/canonSubscription.js';
import { subscribeChatSessions } from '../src/chatSessionSubscription.js';
import { subscribeCookSession, subscribeMyCookSessions } from '../src/cookSessionSubscription.js';
import { subscribeDevSettings } from '../src/devSettingsSync.js';
import { subscribeEquipmentIcons } from '../src/equipmentIconSubscription.js';
import { subscribeEquipmentManifest } from '../src/equipmentManifestSubscription.js';
import { subscribeFormula } from '../src/formulaSubscription.js';
import { subscribeGuidedPlan } from '../src/guidedPlanSubscription.js';
import { subscribeKitchenMemories } from '../src/kitchenMemorySubscription.js';
import { subscribeKitchenTimers } from '../src/kitchenTimerSubscription.js';
import { subscribeKitchenTools } from '../src/kitchenToolSubscription.js';
import {
  subscribeMealPlanConfig,
  subscribeMealPlanTemplate,
  subscribeMealPlanWeek,
} from '../src/mealPlanSync.js';
import { subscribeMembers } from '../src/membersSubscription.js';
import { subscribeProductForms } from '../src/productFormSubscription.js';
import { subscribeRecipes } from '../src/recipeSubscription.js';
import { subscribeShoppingDaysInRange } from '../src/shoppingDaySync.js';
import { subscribeShoppingListItems } from '../src/shoppingListItemSubscription.js';
import { subscribeShoppingLists } from '../src/shoppingListSubscription.js';
import { subscribeShoppingListsConfig } from '../src/shoppingListsConfigSubscription.js';
import { subscribeWeatherForecast } from '../src/weatherSync.js';

// ─── Harness ────────────────────────────────────────────────────────────────
// There is deliberately no second Firebase client here — seeding goes through
// the REST door (see the header), so the only SDK client in this file is the
// one under test.
//
// ─── Why the client is rebuilt per TEST ────────────────────────────────────
// `clearFirestoreEmulator` goes through the REST door, so it wipes the SERVER
// and cannot reach the SDK's local cache. That cache is the isolation boundary
// here: a listener attached after a REST clear still raises its first,
// `fromCache` snapshot from whatever the client learned in the previous test,
// because nothing told the client those documents were gone. Rebuilding the app
// per describe BLOCK was tried and is wrong for exactly that reason — 14 of the
// 15 collection blocks failed `delivers an empty list when the collection is
// empty` with the PREVIOUS test's document in the first snapshot. Data
// isolation is not a property of the clear; it is a property of the clear plus
// a fresh client.
//
// The rebuild also contains a poisoned Listen channel to the test that poisoned
// it, which is why `realtimeSubscriptions.emulator.test.ts` does the same in
// `beforeEach` (#319/#122) — but do not read that as this file's flake defence,
// because it measurably is not. Per-block and per-test shapes both hit
// #122 about once a run, so the number of client rebuilds is not what drives it.
// What drives it is one specific write pattern, and the note on the
// corrupt-document row below records the measurement and the fix.
//
// This suite has NO retries and must not gain any (see vitest.emulator.config.ts
// and docs/unit-test-spec.md UT-G3). If it flakes, the fix is here or in the
// transport, never a retry.

const CONVERGENCE_MS = 15_000;
/** Cold-stack warm-up ceiling. Under vitest.emulator.config.ts's 30 s hookTimeout. */
const WARMUP_MS = 25_000;
const _env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const FIRESTORE_PORT = Number(_env['VITE_EMULATOR_FIRESTORE_PORT'] ?? 8080);

// Order matters: wipe the server first, then hand the test a client that has
// never seen the wiped data. The reverse leaves the fresh client's first read
// racing the delete.
beforeEach(async () => {
  await clearFirestoreEmulator();
  await resetDefaultApp();
});

// The corrupt rows spy on `console.error` (the rejection signal — see the
// header). Files share a worker and `isolate: false` keeps module state alive
// across them, so an unrestored spy would land on an unrelated file and read as
// flake (docs/unit-test-spec.md UT-F4).
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Pay the emulator's cold-start cost once, here, instead of charging it to
 * whichever row happens to run first.
 *
 * `docker compose up --wait` gates on the container healthcheck, which probes
 * the emulator's REST surface. The gRPC Listen path that healthcheck never
 * touches is cold on the first attach of a run: measured on a freshly
 * `down -v`/`up` stack, the first subscription to receive a snapshot took over
 * 15 s while every one after it took 65-190 ms. Without this hook that lands as
 * a convergence timeout on row 1 — `subscribeAisles`, which is why that name
 * keeps appearing in flake reports — and reads as a broken subscription when it
 * is nothing of the kind. It is the cold-start dominance #734 measured for e2e
 * (~47% failure cold vs ~0.6% warm) arriving in this suite.
 *
 * This is NOT a widened budget, which UT-F1 forbids: CONVERGENCE_MS stays at
 * 15 s and every row still has to meet it. The hook only moves an environmental
 * cost out of a measurement that was never about it, and a genuinely dead
 * emulator now fails HERE — naming the stack — instead of blaming a row.
 */
beforeAll(async () => {
  await resetDefaultApp();
  const seen: unknown[] = [];
  const stop = subscribeAisles(
    (aisles) => seen.push(aisles),
    (err) => seen.push(err),
  );
  try {
    await waitFor(
      () => seen.length > 0,
      WARMUP_MS,
      'the emulator to answer the first Listen of the run (cold gRPC stack)',
    );
  } finally {
    stop();
  }
});

/** The uid the SUBSCRIBING app is signed in as. Only valid inside a test. */
function ownerUid(): string {
  const uid = getAuth(getApp()).currentUser?.uid;
  if (!uid) throw new Error('default app is not signed in');
  return uid;
}

/**
 * Convert a plain JS value to the Firestore REST `Value` union.
 *
 * Integers and doubles are distinct Firestore types and zod cares: a
 * `schemaVersion: 1` written as a double reads back as 1 and still parses, but
 * an `order: 0` written as a string would not. Keep the mapping total — an
 * unhandled type must throw here rather than silently seed a document the
 * subscription then skips as invalid, which would look like a delivery failure.
 */
function toRestValue(v: unknown): Record<string, unknown> {
  if (v === null) return { nullValue: null };
  switch (typeof v) {
    case 'string':
      return { stringValue: v };
    case 'boolean':
      return { booleanValue: v };
    case 'number':
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    case 'object':
      if (Array.isArray(v)) return { arrayValue: { values: v.map(toRestValue) } };
      return { mapValue: { fields: toRestFields(v as Record<string, unknown>) } };
    default:
      throw new Error(`no Firestore REST mapping for ${typeof v}`);
  }
}

function toRestFields(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, toRestValue(v)]),
  );
}

/**
 * Seed one document through the emulator's REST API, bypassing security rules.
 * See the header: eight of the 28 collections are closed to client writes, so
 * this is the only door that seeds all of them the same way.
 */
async function writeAs(path: string[], data: Record<string, unknown>): Promise<void> {
  const url =
    `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${path.join('/')}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: toRestFields(data) }),
  });
  if (!resp.ok) {
    throw new Error(
      `REST seed of ${path.join('/')} failed: HTTP ${resp.status} ${await resp.text()}`,
    );
  }
}

/**
 * `waitFor`'s poll tick, and nothing else. No test in this file sleeps to let
 * something happen — every wait is on an observed signal (UT-F3).
 */
function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until `predicate` holds. On timeout the message carries whatever the
 * subscription reported to `onError` — without that, a schema mismatch in a
 * fixture and a genuine delivery failure produce the identical bare "timed out",
 * which is the difference between a five-minute fix and an afternoon.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  what: string,
  errors: DomainError[] = [],
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      const reported = errors.length ? ` — onError reported ${JSON.stringify(errors)}` : '';
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${reported}`);
    }
    await tick(50);
  }
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
// Minimal documents that satisfy their schema. Every one was derived from the
// schema itself rather than hand-guessed, so a required field added upstream
// fails this suite loudly instead of silently skipping the doc as invalid.

const NOW = '2026-08-24T00:00:00.000Z';

/**
 * Structurally invalid for EVERY schema: the id/discriminant fields are wrong types.
 *
 * NOT sufficient on its own. A corrupt document only exercises the skip path if
 * the subscription's QUERY returns it, and Firestore excludes a document that is
 * missing the ordered field entirely — so a row whose query carries an `orderBy`
 * must spread this over a document that still has that field
 * (`subscribeBatchObservations` and its `at`), and a row with a `where` must keep
 * the filtered field valid (`chatSessions`/`cookSessions` and their `ownerUid`).
 * The corrupt rows assert the rejection LOG for exactly this reason.
 */
const CORRUPT = { id: 42, schemaVersion: 'not-a-number', updatedAt: false } as const;

const fx = {
  aislesDoc: (id: string) => ({
    schemaVersion: 1,
    updatedAt: NOW,
    aisles: [{ id, name: 'Produce', order: 0 }],
  }),
  batch: (id: string) => ({
    id,
    schemaVersion: 1,
    recipeId: 'r1',
    recipeTitle: 'Sourdough',
    state: 'running',
    quantities: [],
    totals: {
      basisGrams: 1,
      totalGrams: 1,
      usableGrams: 1,
      units: { label: 'loaf', count: 1, unitDoughGrams: 1, bakedUnitGrams: 1 },
    },
    stages: [],
    rationale: 'x',
    createdAt: NOW,
    updatedAt: NOW,
  }),
  batchObservation: (id: string, at: string = NOW) => ({
    id,
    schemaVersion: 1,
    at,
    weightGrams: 0,
    ph: 0,
    temperatureC: 0,
    note: 'x',
    image: { url: 'https://example.test/x.webp', source: 'upload' },
  }),
  canonItem: (id: string) => ({
    id,
    schemaVersion: 5,
    name: 'Carrot',
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: NOW,
  }),
  chatSession: (id: string, uid: string) => ({
    id,
    schemaVersion: 1,
    ownerUid: uid,
    recipeId: null,
    title: 'Chat',
    messages: [],
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  }),
  cookSession: (id: string, uid: string, updatedAt: string = NOW) => ({
    id,
    schemaVersion: 1,
    ownerUid: uid,
    recipeId: 'r1',
    recipeUpdatedAtAtStart: NOW,
    createdAt: NOW,
    updatedAt,
  }),
  equipmentIcon: () => ({
    subjectBrief: 'a steel pan',
    briefSourceName: 'pan',
    thumbnail: 'https://example.test/x.webp',
  }),
  equipmentManifest: () => ({ schemaVersion: 1, updatedAt: NOW, items: [] }),
  formula: (recipeId: string) => ({
    recipeId,
    components: [],
    referenceYield: { kind: 'basis', grams: 1 },
  }),
  guidedPlan: (id: string) => ({
    id,
    schemaVersion: 1,
    recipeId: id,
    recipeUpdatedAtAtSave: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  }),
  kitchenMemory: (id: string) => ({
    id,
    text: 'salt the pasta water',
    author: 'D',
    createdAt: NOW,
  }),
  kitchenTimers: (uid: string) => ({ ownerUid: uid, timers: [] }),
  kitchenTool: (id: string) => ({
    id,
    schemaVersion: 1,
    label: 'Whisk',
    matchers: [],
    createdAt: NOW,
    updatedAt: NOW,
  }),
  mealPlanConfig: () => ({ firstDayOfWeek: 'fri', schemaVersion: 1 }),
  mealPlanTemplate: () => ({ schemaVersion: 1, days: {} }),
  mealPlanWeek: (startDate: string) => ({
    id: startDate,
    schemaVersion: 1,
    startDate,
    days: {},
    updatedAt: NOW,
  }),
  member: (id: string) => ({
    id,
    schemaVersion: 1,
    name: 'Daniel',
    email: 'a@b.test',
    admin: false,
    sortOrder: 0,
    updatedAt: NOW,
  }),
  productForm: (id: string) => ({
    id,
    schemaVersion: 1,
    matchers: [],
    parentCanonId: 'canon-1',
    label: 'Yolk',
    yield: { formUnit: 'g', amountPerParent: 1 },
    updatedAt: NOW,
  }),
  recipe: (id: string) => ({
    id,
    schemaVersion: 1,
    title: 'Toast',
    description: '',
    ingredients: [],
    steps: [],
    metadata: {
      servings: 1,
      totalTimeMinutes: 1,
      prepTimeMinutes: 1,
      cookTimeMinutes: 0,
      tags: [],
    },
    source: { type: 'manual' },
    notes: '',
    image: null,
    createdAt: NOW,
    updatedAt: NOW,
  }),
  shoppingDay: (date: string) => ({ date, slot: 'am', setBy: 'x', setAt: NOW }),
  shoppingList: (id: string) => ({
    id,
    name: 'Weekly',
    schemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }),
  shoppingListItem: (id: string) => ({
    id,
    rawText: 'carrots',
    notes: '',
    sources: [],
    canonId: null,
    matchState: 'pending',
    checked: false,
    needsCheck: false,
    schemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }),
  shoppingListsConfig: (defaultListId: string) => ({ defaultListId, schemaVersion: 1 }),
  weatherForecast: () => ({
    days: {},
    fetchedAt: 1,
    location: { latitude: 0, longitude: 0, timezone: 'Europe/London', label: 'London' },
    timezone: 'Europe/London',
  }),
  appSettings: () => ({ schemaVersion: 1 }),
  devSettings: () => ({ schemaVersion: 1 }),
};

// ─── The tables ─────────────────────────────────────────────────────────────

type ErrCb = (err: DomainError, rawError?: unknown) => void;

interface CollectionCase {
  name: string;
  /** Subscribe, normalising whatever is delivered to a list of ids. */
  subscribe: (onIds: (ids: string[]) => void, onError: ErrCb) => () => void;
  /** The id the seeded document will be recognised by. */
  id: string;
  /** Seed the valid document. */
  seed: () => Promise<void>;
  /**
   * Seed a structurally invalid sibling, and NAME it. Omitted only where the
   * subscription reads a SINGLE document holding an array, so a corrupt entry
   * fails the whole document rather than being skipped — the reason is the
   * string.
   *
   * `id` is the document id the subscription's parse loop logs on rejection, and
   * the row asserts that log. It must be an id the query actually RETURNS: see
   * the note on `CORRUPT`.
   */
  corrupt?: { id: string; seed: () => Promise<void> };
  noCorruptCase?: string;
  /**
   * Seed the documents this subscription's filter/path must LEAVE OUT, and name
   * their ids. Without this a filter is untestable by construction — every row
   * would seed only what the query admits, and deleting the `where` would keep
   * the suite green (#939).
   */
  excluded?: { ids: string[]; seed: () => Promise<void> };
  /** Why this row has no bound to exclude anything with. Required when `excluded` is absent. */
  noExcludedCase?: string;
  /**
   * Seed documents whose DELIVERED order the query fixes, and name that order
   * exactly. Only for rows carrying an `orderBy` (and, for cook sessions, a
   * `limit` — the expected list is shorter than what is seeded, which pins both
   * in one row). The seeded ids are chosen so Firestore's default `__name__`
   * ordering would give a DIFFERENT answer, or dropping the `orderBy` would
   * still pass.
   */
  ordered?: { ids: string[]; seed: () => Promise<void>; what: string };
}

const LIST_ID = 'list-1';
const OTHER_LIST_ID = 'list-2';
const BATCH_ID = 'batch-1';
const OTHER_BATCH_ID = 'batch-2';
const WEEK_START = '2026-08-21';
const OTHER_WEEK_START = '2026-08-14';
const RANGE_START = '2026-08-17';
const RANGE_END = '2026-08-23';
/** A uid that is never the subscriber's — every owner-filtered row seeds one of these. */
const OTHER_UID = 'not-the-subscriber';

const collectionCases: CollectionCase[] = [
  {
    name: 'subscribeAisles',
    subscribe: (on, err) => subscribeAisles((aisles) => on(aisles.map((a) => a.id)), err),
    id: 'produce',
    seed: () => writeAs(['canonData', 'aisles'], fx.aislesDoc('produce')),
    noCorruptCase:
      'reads ONE document holding the whole array, so a corrupt entry fails the document rather than being skipped past',
    noExcludedCase: 'reads ONE document at a fixed id — no query, so nothing to narrow',
  },
  {
    name: 'subscribeBatches',
    subscribe: (on, err) => subscribeBatches((batches) => on(batches.map((b) => b.id)), err),
    id: BATCH_ID,
    seed: () => writeAs(['batches', BATCH_ID], fx.batch(BATCH_ID)),
    corrupt: { id: 'bad', seed: () => writeAs(['batches', 'bad'], CORRUPT) },
    noExcludedCase: 'reads the whole collection unfiltered and unordered',
  },
  {
    name: 'subscribeBatchObservations',
    subscribe: (on, err) =>
      subscribeBatchObservations(BATCH_ID, (obs) => on(obs.map((o) => o.id)), err),
    id: 'obs-1',
    seed: () =>
      writeAs(['batches', BATCH_ID, 'observations', 'obs-1'], fx.batchObservation('obs-1')),
    // `at` is NOT decoration here. The query is `orderBy('at','asc')` and
    // Firestore omits a document missing the ordered field, so a corrupt sibling
    // without one is never returned — nothing is skipped, and the row would go
    // green on an INVISIBLE document rather than a rejected one. `id: 42` is what
    // still fails the schema.
    corrupt: {
      id: 'bad',
      seed: () => writeAs(['batches', BATCH_ID, 'observations', 'bad'], { ...CORRUPT, at: NOW }),
    },
    // The log belongs to ONE run. An observation under another batch is a
    // different subcollection and must never appear.
    excluded: {
      ids: ['other-obs'],
      seed: () =>
        writeAs(
          ['batches', OTHER_BATCH_ID, 'observations', 'other-obs'],
          fx.batchObservation('other-obs'),
        ),
    },
    // Ordered by WHEN THE READING WAS TAKEN, not by arrival or by id — the whole
    // point of the module's own comment. `obs-a` is later than `obs-b`, so id
    // order and `at` order disagree and only the real `orderBy` gives this answer.
    ordered: {
      what: "orderBy('at','asc') — oldest reading first, whatever the ids say",
      ids: ['obs-b', 'obs-a'],
      seed: async () => {
        await writeAs(
          ['batches', BATCH_ID, 'observations', 'obs-a'],
          fx.batchObservation('obs-a', '2026-08-24T03:00:00.000Z'),
        );
        await writeAs(
          ['batches', BATCH_ID, 'observations', 'obs-b'],
          fx.batchObservation('obs-b', '2026-08-24T01:00:00.000Z'),
        );
      },
    },
  },
  {
    name: 'subscribeCanonItems',
    subscribe: (on, err) => subscribeCanonItems((items) => on(items.map((i) => i.id)), err),
    id: 'carrot',
    seed: () => writeAs(['canonItems', 'carrot'], fx.canonItem('carrot')),
    corrupt: { id: 'bad', seed: () => writeAs(['canonItems', 'bad'], CORRUPT) },
    noExcludedCase: 'reads the whole collection unfiltered and unordered',
  },
  {
    name: 'subscribeChatSessions',
    subscribe: (on, err) =>
      subscribeChatSessions(ownerUid(), (sessions) => on(sessions.map((s) => s.id)), err),
    id: 'chat-1',
    seed: () => writeAs(['chatSessions', 'chat-1'], fx.chatSession('chat-1', ownerUid())),
    // The corrupt sibling must still be OWNED by the subscriber, or the query's
    // `where('ownerUid','==',uid)` filters it out server-side and the row would
    // prove nothing about skip-invalid.
    corrupt: {
      id: 'bad',
      seed: () => writeAs(['chatSessions', 'bad'], { ...CORRUPT, ownerUid: ownerUid() }),
    },
    excluded: {
      ids: ['chat-theirs'],
      seed: () =>
        writeAs(['chatSessions', 'chat-theirs'], fx.chatSession('chat-theirs', OTHER_UID)),
    },
  },
  {
    name: 'subscribeMyCookSessions',
    subscribe: (on, err) =>
      subscribeMyCookSessions(ownerUid(), (sessions) => on(sessions.map((s) => s.id)), err),
    id: 'cook-1',
    seed: () => writeAs(['cookSessions', 'cook-1'], fx.cookSession('cook-1', ownerUid())),
    corrupt: {
      id: 'bad',
      seed: () => writeAs(['cookSessions', 'bad'], { ...CORRUPT, ownerUid: ownerUid() }),
    },
    excluded: {
      ids: ['cook-theirs'],
      seed: () =>
        writeAs(['cookSessions', 'cook-theirs'], fx.cookSession('cook-theirs', OTHER_UID)),
    },
    // Six sessions, five delivered: this one row pins `orderBy('updatedAt','desc')`
    // AND `limit(5)`. The ids ascend with the timestamps, so the default
    // `__name__` order would deliver s1..s5 — the complement of the right answer
    // in both membership and order.
    ordered: {
      what: "orderBy('updatedAt','desc') + limit(5) — the five most recent, newest first",
      ids: ['s6', 's5', 's4', 's3', 's2'],
      seed: async () => {
        const uid = ownerUid();
        for (let i = 1; i <= 6; i += 1) {
          await writeAs(
            ['cookSessions', `s${i}`],
            fx.cookSession(`s${i}`, uid, `2026-08-24T00:00:0${i}.000Z`),
          );
        }
      },
    },
  },
  {
    name: 'subscribeEquipmentIcons',
    subscribe: (on, err) => subscribeEquipmentIcons((icons) => on([...icons.keys()]), err),
    id: 'pan',
    seed: () => writeAs(['equipmentIcons', 'pan'], fx.equipmentIcon()),
    corrupt: { id: 'bad', seed: () => writeAs(['equipmentIcons', 'bad'], CORRUPT) },
    noExcludedCase: 'reads the whole collection unfiltered and unordered',
  },
  {
    name: 'subscribeKitchenMemories',
    subscribe: (on, err) => subscribeKitchenMemories((mems) => on(mems.map((m) => m.id)), err),
    id: 'mem-1',
    seed: () => writeAs(['kitchenMemories', 'mem-1'], fx.kitchenMemory('mem-1')),
    corrupt: { id: 'bad', seed: () => writeAs(['kitchenMemories', 'bad'], CORRUPT) },
    noExcludedCase: 'reads the whole collection unfiltered and unordered',
  },
  {
    name: 'subscribeKitchenTools',
    subscribe: (on, err) => subscribeKitchenTools((tools) => on(tools.map((t) => t.id)), err),
    id: 'whisk',
    seed: () => writeAs(['kitchenTools', 'whisk'], fx.kitchenTool('whisk')),
    corrupt: { id: 'bad', seed: () => writeAs(['kitchenTools', 'bad'], CORRUPT) },
    noExcludedCase: 'reads the whole collection unfiltered and unordered',
  },
  {
    name: 'subscribeMembers',
    subscribe: (on, err) => subscribeMembers((members) => on(members.map((m) => m.id)), err),
    id: 'a@b.test',
    seed: () => writeAs(['members', 'a@b.test'], fx.member('a@b.test')),
    corrupt: { id: 'bad@b.test', seed: () => writeAs(['members', 'bad@b.test'], CORRUPT) },
    noExcludedCase: 'reads the whole collection unfiltered and unordered',
  },
  {
    name: 'subscribeProductForms',
    subscribe: (on, err) => subscribeProductForms((forms) => on(forms.map((f) => f.id)), err),
    id: 'yolk',
    seed: () => writeAs(['productForms', 'yolk'], fx.productForm('yolk')),
    corrupt: { id: 'bad', seed: () => writeAs(['productForms', 'bad'], CORRUPT) },
    noExcludedCase: 'reads the whole collection unfiltered and unordered',
  },
  {
    name: 'subscribeRecipes',
    subscribe: (on, err) => subscribeRecipes((recipes) => on(recipes.map((r) => r.id)), err),
    id: 'toast',
    seed: () => writeAs(['recipes', 'toast'], fx.recipe('toast')),
    corrupt: { id: 'bad', seed: () => writeAs(['recipes', 'bad'], CORRUPT) },
    noExcludedCase: 'reads the whole collection unfiltered and unordered',
  },
  {
    name: 'subscribeShoppingDaysInRange',
    subscribe: (on, err) =>
      subscribeShoppingDaysInRange(
        RANGE_START,
        RANGE_END,
        (days) => on(days.map((d) => d.date)),
        err,
      ),
    id: '2026-08-19',
    seed: () => writeAs(['shoppingDays', '2026-08-19'], fx.shoppingDay('2026-08-19')),
    // In range, so the documentId() bounds return it and the parse loop rejects it.
    corrupt: { id: '2026-08-20', seed: () => writeAs(['shoppingDays', '2026-08-20'], CORRUPT) },
    // One day either side of the inclusive range. Delete either `where` clause in
    // shoppingDaySync.ts and one of these arrives.
    excluded: {
      ids: ['2026-08-16', '2026-08-24'],
      seed: async () => {
        await writeAs(['shoppingDays', '2026-08-16'], fx.shoppingDay('2026-08-16'));
        await writeAs(['shoppingDays', '2026-08-24'], fx.shoppingDay('2026-08-24'));
      },
    },
  },
  {
    name: 'subscribeShoppingListItems',
    subscribe: (on, err) =>
      subscribeShoppingListItems(LIST_ID, (items) => on(items.map((i) => i.id)), err),
    id: 'item-1',
    seed: () =>
      writeAs(['shoppingLists', LIST_ID, 'items', 'item-1'], fx.shoppingListItem('item-1')),
    corrupt: {
      id: 'bad',
      seed: () => writeAs(['shoppingLists', LIST_ID, 'items', 'bad'], CORRUPT),
    },
    excluded: {
      ids: ['other-item'],
      seed: () =>
        writeAs(
          ['shoppingLists', OTHER_LIST_ID, 'items', 'other-item'],
          fx.shoppingListItem('other-item'),
        ),
    },
  },
  {
    name: 'subscribeShoppingLists',
    subscribe: (on, err) => subscribeShoppingLists((lists) => on(lists.map((l) => l.id)), err),
    id: LIST_ID,
    seed: () => writeAs(['shoppingLists', LIST_ID], fx.shoppingList(LIST_ID)),
    corrupt: { id: 'bad', seed: () => writeAs(['shoppingLists', 'bad'], CORRUPT) },
    noExcludedCase: 'reads the whole collection unfiltered and unordered',
  },
];

interface DocumentCase {
  name: string;
  subscribe: (onDoc: (d: unknown) => void, onError: ErrCb) => () => void;
  seed: () => Promise<void>;
  corrupt: () => Promise<void>;
  /** Recognise the seeded document among what was delivered. */
  matches: (d: unknown) => boolean;
  /**
   * What this subscription ACTUALLY does with a document that fails its schema.
   *
   * `'error'` — `onError({kind:'StorageError', reason:'corruption'})`, which is
   * what CLAUDE.md's zod conventions require of a single-document adapter read.
   * `'null'`  — logs and delivers `null`, indistinguishable to the caller from
   * a document that does not exist.
   *
   * Eleven rows are `'error'`; `subscribeCookSession` and
   * `subscribeKitchenTimers` are `'null'`. That divergence was found BY this
   * table and is recorded here rather than normalised away, because a
   * characterisation test's job is to state what the code does today — #928 can
   * then unify it as a deliberate, visible behaviour change instead of a silent
   * one buried inside a consolidation.
   *
   * The `'null'` rows carry one extra assertion the `'error'` rows do not need:
   * that the parse loop LOGGED the rejection. `null` is by design
   * indistinguishable from "absent" to the caller, so without the log the row
   * cannot tell a rejected document from one the read never saw. A
   * `StorageError`/`corruption` on `onError` needs no such backstop — an absent
   * document cannot produce one.
   */
  onCorrupt: 'error' | 'null';
  /**
   * Seed a VALID document of the same schema at a DIFFERENT key in the same
   * collection. A keyed single-document read has no filter to narrow, but it does
   * have a key, and a row that only ever seeds the key it asks for cannot tell
   * "reads the document at `id`" from "reads whatever is in the collection".
   */
  excluded?: { seed: () => Promise<void>; what: string };
  /** Why this row has no other key to get wrong. Required when `excluded` is absent. */
  noExcludedCase?: string;
}

const has = (d: unknown, key: string, value: unknown): boolean =>
  typeof d === 'object' && d !== null && (d as Record<string, unknown>)[key] === value;

const documentCases: DocumentCase[] = [
  {
    name: 'subscribeAppSettings',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeAppSettings(on, err),
    seed: () => writeAs(['appSettings', 'singleton'], fx.appSettings()),
    corrupt: () => writeAs(['appSettings', 'singleton'], { schemaVersion: 'nope' }),
    matches: (d) => has(d, 'schemaVersion', 1),
    noExcludedCase:
      'reads a fixed singleton id, so there is no other key it could read — the delivery row above already pins which id that is',
  },
  {
    name: 'subscribeBatch',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeBatch(BATCH_ID, on, err),
    seed: () => writeAs(['batches', BATCH_ID], fx.batch(BATCH_ID)),
    corrupt: () => writeAs(['batches', BATCH_ID], CORRUPT),
    matches: (d) => has(d, 'id', BATCH_ID),
    excluded: {
      what: 'another run in the same collection',
      seed: () => writeAs(['batches', OTHER_BATCH_ID], fx.batch(OTHER_BATCH_ID)),
    },
  },
  {
    name: 'subscribeCookSession',
    onCorrupt: 'null',
    subscribe: (on, err) => subscribeCookSession('cook-1', on, err),
    seed: () => writeAs(['cookSessions', 'cook-1'], fx.cookSession('cook-1', ownerUid())),
    // Keep ownerUid valid so the doc is READABLE; only the rest is corrupt. A
    // doc the rules deny is an AuthError, not the StorageError this row pins.
    corrupt: () => writeAs(['cookSessions', 'cook-1'], { ...CORRUPT, ownerUid: ownerUid() }),
    matches: (d) => has(d, 'id', 'cook-1'),
    // Owned by the subscriber, so the rules would ALLOW this read — the only
    // thing keeping it out of the delivery is the key.
    excluded: {
      what: "the same member's session on another recipe",
      seed: () => writeAs(['cookSessions', 'cook-2'], fx.cookSession('cook-2', ownerUid())),
    },
  },
  {
    name: 'subscribeDevSettings',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeDevSettings(on, err),
    seed: () => writeAs(['devSettings', 'singleton'], fx.devSettings()),
    corrupt: () => writeAs(['devSettings', 'singleton'], { schemaVersion: 'nope' }),
    matches: (d) => has(d, 'schemaVersion', 1),
    noExcludedCase:
      'reads a fixed singleton id, so there is no other key it could read — the delivery row above already pins which id that is',
  },
  {
    name: 'subscribeEquipmentManifest',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeEquipmentManifest(on, err),
    seed: () => writeAs(['equipmentManifest', 'current'], fx.equipmentManifest()),
    corrupt: () => writeAs(['equipmentManifest', 'current'], CORRUPT),
    matches: (d) => has(d, 'schemaVersion', 1),
    noExcludedCase:
      'reads a fixed singleton id, so there is no other key it could read — the delivery row above already pins which id that is',
  },
  {
    name: 'subscribeFormula',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeFormula('r1', on, err),
    seed: () => writeAs(['formulas', 'r1'], fx.formula('r1')),
    corrupt: () => writeAs(['formulas', 'r1'], CORRUPT),
    matches: (d) => has(d, 'recipeId', 'r1'),
    excluded: {
      what: "another recipe's formula",
      seed: () => writeAs(['formulas', 'r2'], fx.formula('r2')),
    },
  },
  {
    name: 'subscribeGuidedPlan',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeGuidedPlan('r1', on, err),
    seed: () => writeAs(['guidedPlans', 'r1'], fx.guidedPlan('r1')),
    corrupt: () => writeAs(['guidedPlans', 'r1'], CORRUPT),
    matches: (d) => has(d, 'recipeId', 'r1'),
    excluded: {
      what: "another recipe's plan",
      seed: () => writeAs(['guidedPlans', 'r2'], fx.guidedPlan('r2')),
    },
  },
  {
    name: 'subscribeKitchenTimers',
    onCorrupt: 'null',
    subscribe: (on, err) => subscribeKitchenTimers(ownerUid(), on, err),
    seed: () => writeAs(['kitchenTimers', ownerUid()], fx.kitchenTimers(ownerUid())),
    corrupt: () => writeAs(['kitchenTimers', ownerUid()], { ownerUid: ownerUid(), timers: 'nope' }),
    // Matches on the OWNER, not merely on the field being present: the id IS the
    // uid here, so a laxer predicate would accept the other member's document.
    matches: (d) => has(d, 'ownerUid', ownerUid()),
    excluded: {
      what: "another member's timers",
      seed: () => writeAs(['kitchenTimers', OTHER_UID], fx.kitchenTimers(OTHER_UID)),
    },
  },
  {
    name: 'subscribeMealPlanConfig',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeMealPlanConfig(on, err),
    seed: () => writeAs(['mealPlanConfig', 'singleton'], fx.mealPlanConfig()),
    corrupt: () => writeAs(['mealPlanConfig', 'singleton'], CORRUPT),
    matches: (d) => has(d, 'firstDayOfWeek', 'fri'),
    noExcludedCase:
      'reads a fixed singleton id, so there is no other key it could read — the delivery row above already pins which id that is',
  },
  {
    name: 'subscribeMealPlanTemplate',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeMealPlanTemplate(on, err),
    seed: () => writeAs(['mealPlanTemplate', 'singleton'], fx.mealPlanTemplate()),
    corrupt: () => writeAs(['mealPlanTemplate', 'singleton'], CORRUPT),
    matches: (d) => has(d, 'schemaVersion', 1),
    noExcludedCase:
      'reads a fixed singleton id, so there is no other key it could read — the delivery row above already pins which id that is',
  },
  {
    name: 'subscribeMealPlanWeek',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeMealPlanWeek(WEEK_START, on, err),
    seed: () => writeAs(['mealPlans', WEEK_START], fx.mealPlanWeek(WEEK_START)),
    corrupt: () => writeAs(['mealPlans', WEEK_START], CORRUPT),
    matches: (d) => has(d, 'startDate', WEEK_START),
    excluded: {
      what: 'the week before',
      seed: () => writeAs(['mealPlans', OTHER_WEEK_START], fx.mealPlanWeek(OTHER_WEEK_START)),
    },
  },
  {
    name: 'subscribeShoppingListsConfig',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeShoppingListsConfig(on, err),
    seed: () => writeAs(['shoppingListsConfig', 'singleton'], fx.shoppingListsConfig(LIST_ID)),
    corrupt: () => writeAs(['shoppingListsConfig', 'singleton'], { defaultListId: 42 }),
    matches: (d) => has(d, 'defaultListId', LIST_ID),
    noExcludedCase:
      'reads a fixed singleton id, so there is no other key it could read — the delivery row above already pins which id that is',
  },
  {
    name: 'subscribeWeatherForecast',
    onCorrupt: 'error',
    subscribe: (on, err) => subscribeWeatherForecast(on, err),
    seed: () => writeAs(['weatherForecast', 'singleton'], fx.weatherForecast()),
    corrupt: () => writeAs(['weatherForecast', 'singleton'], CORRUPT),
    matches: (d) => has(d, 'timezone', 'Europe/London'),
    noExcludedCase:
      'reads a fixed singleton id, so there is no other key it could read — the delivery row above already pins which id that is',
  },
];

// ─── The guard ──────────────────────────────────────────────────────────────

/**
 * Read every `subscribe*` in `src/` off disk and report which Firestore query
 * operators its own body issues.
 *
 * Derived from the tree, never from a list (UT-E1), and matched on call shape
 * rather than on any sentence (UT-E3). Comments are stripped first — several
 * modules discuss their `where`/`orderBy` in prose right above the code, and a
 * scan that counted those would report bounds nothing actually issues.
 *
 * Splitting on `\nexport ` keeps each operator with the function that issues it:
 * `cookSessionSubscription.ts` exports one subscription WITH a query and one
 * without, from the same file.
 */
function queryOperatorsBySubscription(): Map<string, string[]> {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const found = new Map<string, string[]>();
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(srcDir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const chunk of src.split(/\nexport /)) {
      const declared = /^(?:async\s+)?function\s+(subscribe\w+)\s*\(/.exec(chunk);
      if (!declared) continue;
      found.set(
        declared[1]!,
        ['where', 'orderBy', 'limit'].filter((op) => new RegExp(`\\b${op}\\(`).test(chunk)),
      );
    }
  }
  return found;
}

describe('subscription contract — table coverage', () => {
  it('covers every exported subscribe* — derived from the barrel, not a hand-kept list', () => {
    const exported = Object.keys(barrel)
      .filter((k) => k.startsWith('subscribe'))
      .sort();
    const tabled = [...collectionCases, ...documentCases].map((c) => c.name).sort();

    // A new subscription must arrive with a row. This is the recurrence guard
    // #928 asks for: the shape only exists once to copy from, and the table is
    // what notices when someone copies it anyway.
    expect(tabled).toEqual(exported);
    expect(exported).toHaveLength(28);
  });

  it('every row is uniquely named', () => {
    const names = [...collectionCases, ...documentCases].map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a row that skips the corrupt-document case says why', () => {
    for (const c of collectionCases) {
      if (!c.corrupt) {
        expect(c.noCorruptCase, `${c.name} skips the corrupt case without a reason`).toBeTruthy();
      }
    }
  });

  /**
   * The #939 counterpart of the rule above. A subscription that carries a filter
   * or a path bound and seeds only what its query ADMITS pins nothing about the
   * query — this is what makes the omission cost something instead of passing
   * unnoticed.
   */
  it('a row that skips the query-bound case says why', () => {
    for (const c of [...collectionCases, ...documentCases]) {
      if (!c.excluded) {
        expect(
          c.noExcludedCase,
          `${c.name} seeds nothing its query must exclude, and gives no reason`,
        ).toBeTruthy();
      }
    }
  });

  /**
   * The rule above is only worth having if it cannot be satisfied by writing
   * `noExcludedCase: 'no bound'` on a subscription that plainly has one. So the
   * set of bounded subscriptions is read off the SOURCE rather than kept by hand
   * (UT-E1): a module whose `subscribe*` body issues `where(`/`limit(` must have
   * a row seeding what that bound excludes, and one issuing `orderBy(` must have
   * a row asserting the order.
   *
   * This is the half of the net that survives #939. When the narrowing adds a
   * filter to a subscription that has none today, THIS test goes red — before the
   * refactor can claim the net covered it.
   */
  it('every subscription that issues a query has a row pinning its bounds', () => {
    const ops = queryOperatorsBySubscription();
    const exported = Object.keys(barrel)
      .filter((k) => k.startsWith('subscribe'))
      .sort();

    // UT-E2: the walk still finds every subscription, and still recognises all
    // three operators. A scan that quietly stopped matching would otherwise green
    // the rule below on an empty set.
    expect([...ops.keys()].sort()).toEqual(exported);
    expect(new Set([...ops.values()].flat())).toEqual(new Set(['where', 'orderBy', 'limit']));

    const rows = new Map([...collectionCases, ...documentCases].map((c) => [c.name, c] as const));
    const unpinned: string[] = [];
    for (const [name, operators] of ops) {
      const row = rows.get(name);
      if (!row) continue; // the barrel guard above already reports a missing row
      const bounded = operators.includes('where') || operators.includes('limit');
      const ordered = 'ordered' in row ? row.ordered : undefined;
      if (bounded && !row.excluded && !ordered) {
        unpinned.push(`${name} issues ${operators.join('+')} but seeds nothing it excludes`);
      }
      if (operators.includes('orderBy') && !ordered) {
        unpinned.push(`${name} issues orderBy but no row asserts the delivered order`);
      }
    }
    expect(unpinned).toEqual([]);
  });

  it('every corrupt case names the document id its parse loop will log', () => {
    for (const c of collectionCases) {
      if (c.corrupt) expect(c.corrupt.id, `${c.name} corrupt case has no id`).toBeTruthy();
    }
  });
});

// ─── Collection subscriptions ───────────────────────────────────────────────

describe.each(collectionCases)('$name (collection)', (c) => {
  it('delivers the seeded document within the convergence window', async () => {
    const seen: string[][] = [];
    const errors: DomainError[] = [];
    const unsubscribe = c.subscribe(
      (ids) => seen.push(ids),
      (e) => errors.push(e),
    );
    try {
      await c.seed();
      await waitFor(
        () => seen.some((ids) => ids.includes(c.id)),
        CONVERGENCE_MS,
        `${c.name}/${c.id}`,
        errors,
      );
      expect(seen.some((ids) => ids.includes(c.id))).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('delivers an empty list when the collection is empty', async () => {
    const seen: string[][] = [];
    const unsubscribe = c.subscribe(
      (ids) => seen.push(ids),
      () => {},
    );
    try {
      await waitFor(() => seen.length > 0, CONVERGENCE_MS, `${c.name} initial snapshot`);
      expect(seen[0]).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('stops delivering after unsubscribe', async () => {
    const seen: string[][] = [];
    const unsubscribe = c.subscribe(
      (ids) => seen.push(ids),
      () => {},
    );
    await waitFor(() => seen.length > 0, CONVERGENCE_MS, `${c.name} initial snapshot`);
    const before = seen.length;
    unsubscribe();

    // A second, LIVE listener is the real signal that the write reached this
    // client: once the control has the document, the unsubscribed listener would
    // have had it too. Sleeping a fixed interval instead would be an arbitrary
    // sleep (docs/unit-test-spec.md UT-F3) — on a slow run it proves nothing,
    // and on a fast one it is dead time in 28 rows. The control settles its own
    // initial snapshot before the write, so this row still issues exactly one
    // write under an attached listener (see the corrupt row's note).
    const control: string[][] = [];
    const stopControl = c.subscribe(
      (ids) => control.push(ids),
      () => {},
    );
    try {
      await waitFor(() => control.length > 0, CONVERGENCE_MS, `${c.name} control snapshot`);
      await c.seed();
      await waitFor(
        () => control.some((ids) => ids.includes(c.id)),
        CONVERGENCE_MS,
        `${c.name} control delivery`,
      );
    } finally {
      stopControl();
    }

    expect(seen.length).toBe(before);
  });

  const excluded = c.excluded;
  if (excluded) {
    /**
     * The out-of-bounds documents are seeded BEFORE the subscription and the
     * in-bounds one after it. That ordering is what makes the negative assertion
     * mean something without an arbitrary sleep (UT-F3): the excluded documents
     * were on the server first, so by the time the in-bounds one is DELIVERED,
     * they would have been delivered too if the query admitted them. It also
     * keeps the row to one write under an attached listener, like every other
     * row here (see the corrupt row's note on #122).
     */
    it('does not deliver what its query excludes', async () => {
      await excluded.seed();

      const seen: string[][] = [];
      const errors: DomainError[] = [];
      const unsubscribe = c.subscribe(
        (ids) => seen.push(ids),
        (e) => errors.push(e),
      );
      try {
        await waitFor(
          () => seen.length > 0,
          CONVERGENCE_MS,
          `${c.name} initial snapshot past its query bounds`,
          errors,
        );
        expect(seen[0]).toEqual([]);

        await c.seed();
        await waitFor(
          () => seen.some((ids) => ids.includes(c.id)),
          CONVERGENCE_MS,
          `${c.name} in-bounds document`,
          errors,
        );

        // Nothing out of bounds may appear in ANY snapshot, not merely the last:
        // a filter that leaks and then self-corrects has still leaked.
        for (const ids of seen) {
          for (const id of excluded.ids) expect(ids).not.toContain(id);
        }
        expect(errors).toEqual([]);
      } finally {
        unsubscribe();
      }
    });
  }

  const ordered = c.ordered;
  if (ordered) {
    it(`delivers in the order its query fixes — ${ordered.what}`, async () => {
      await ordered.seed();

      const seen: string[][] = [];
      const errors: DomainError[] = [];
      const unsubscribe = c.subscribe(
        (ids) => seen.push(ids),
        (e) => errors.push(e),
      );
      try {
        // The whole LIST, in order — membership would be satisfied by any
        // ordering and by an unbounded read, which is precisely the hole.
        await waitFor(
          () => seen.some((ids) => ids.length === ordered.ids.length),
          CONVERGENCE_MS,
          `${c.name} to converge on ${ordered.ids.length} documents`,
          errors,
        );
        expect(seen[seen.length - 1]).toEqual(ordered.ids);
        expect(errors).toEqual([]);
      } finally {
        unsubscribe();
      }
    });
  }

  const seedCorrupt = c.corrupt;
  if (seedCorrupt) {
    // The corrupt document is seeded BEFORE the subscription and the valid one
    // after it, which pins the skip on both snapshot paths — the initial read
    // and a live update — rather than only on whichever one a single
    // arrangement happens to hit. It also keeps this row to ONE write while a
    // listener is attached, like every other row.
    //
    // That second property is load-bearing. Seeding both documents back to back
    // under an attached listener is the only shape in this file that made the
    // emulator answer two Listen responses with no round trip between them, and
    // it reproduced #122 on demand: across five runs, EVERY
    // `RESOURCE_EXHAUSTED: Received message larger than max` (a phantom 0.5-3 GB
    // frame that puts the client into maximum backoff for good) landed on this
    // row and on no other, on a different collection each time. The transport
    // fix #122 shipped cannot help here — `experimentalForceLongPolling` is a
    // WebChannel option and the SDK's node build always uses `GrpcConnection`
    // (`dist/index.node.mjs`), so this suite is on gRPC whatever init.ts asks
    // for. Removing the back-to-back pair is therefore the only lever the test
    // side has, and it costs the assertion nothing.
    it('skips a corrupt document and still delivers the valid subset', async () => {
      // The rejection signal. Every collection parse loop logs before it skips,
      // so this is what separates "the document was REJECTED" from "the query
      // never returned it" — and the two are otherwise identical from out here.
      // Call-through: the zod error still reaches the console for diagnosis.
      const logged = vi.spyOn(console, 'error');
      await seedCorrupt.seed();

      const seen: string[][] = [];
      const errors: DomainError[] = [];
      const unsubscribe = c.subscribe(
        (ids) => seen.push(ids),
        (e) => errors.push(e),
      );
      try {
        // The initial snapshot already sees the corrupt document, and must
        // deliver the (empty) valid subset rather than failing the whole read.
        await waitFor(
          () => seen.length > 0,
          CONVERGENCE_MS,
          `${c.name} initial snapshot past a corrupt sibling`,
          errors,
        );
        expect(seen[0]).toEqual([]);

        await c.seed();
        await waitFor(
          () => seen.some((ids) => ids.includes(c.id)),
          CONVERGENCE_MS,
          `${c.name} valid subset after a corrupt sibling`,
          errors,
        );

        // The contract (CLAUDE.md, zod conventions): skip the invalid doc, keep
        // the rest, and do NOT fail the whole read.
        const last = seen[seen.length - 1]!;
        expect(last).toContain(c.id);
        expect(last).not.toContain(seedCorrupt.id);
        expect(errors).toEqual([]);

        // …and it was skipped, not merely absent. Without this the row passes on
        // a document the query filtered out server-side, which is how
        // `subscribeBatchObservations` was green while rejecting nothing: the
        // delivered ids come from PARSED documents, so `not.toContain` can never
        // fail whatever the behaviour.
        const rejections = logged.mock.calls.filter(
          ([first]) =>
            typeof first === 'string' &&
            first.includes(`Document ${seedCorrupt.id} failed validation`),
        );
        expect(
          rejections.length,
          `${c.name} delivered the valid subset without ever rejecting ${seedCorrupt.id} — ` +
            'the corrupt document never reached the parse loop',
        ).toBeGreaterThan(0);
      } finally {
        unsubscribe();
      }
    });
  }
});

// ─── Single-document subscriptions ──────────────────────────────────────────

describe.each(documentCases)('$name (document)', (c) => {
  it('delivers null when the document does not exist', async () => {
    const seen: unknown[] = [];
    const unsubscribe = c.subscribe(
      (d) => seen.push(d),
      () => {},
    );
    try {
      await waitFor(() => seen.length > 0, CONVERGENCE_MS, `${c.name} initial snapshot`);
      expect(seen[0]).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('delivers the document after it is written', async () => {
    const seen: unknown[] = [];
    const errors: DomainError[] = [];
    const unsubscribe = c.subscribe(
      (d) => seen.push(d),
      (e) => errors.push(e),
    );
    try {
      await c.seed();
      await waitFor(() => seen.some(c.matches), CONVERGENCE_MS, `${c.name} document`, errors);
      expect(seen.some(c.matches)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('stops delivering after unsubscribe', async () => {
    const seen: unknown[] = [];
    const unsubscribe = c.subscribe(
      (d) => seen.push(d),
      () => {},
    );
    await waitFor(() => seen.length > 0, CONVERGENCE_MS, `${c.name} initial snapshot`);
    const before = seen.length;
    unsubscribe();

    // A second, LIVE listener is the real signal that the write reached this
    // client: once the control has the document, the unsubscribed listener would
    // have had it too. Sleeping a fixed interval instead would be an arbitrary
    // sleep (docs/unit-test-spec.md UT-F3) — on a slow run it proves nothing,
    // and on a fast one it is dead time in 28 rows. The control settles its own
    // initial snapshot before the write, so this row still issues exactly one
    // write under an attached listener (see the corrupt row's note).
    const control: unknown[] = [];
    const stopControl = c.subscribe(
      (d) => control.push(d),
      () => {},
    );
    try {
      await waitFor(() => control.length > 0, CONVERGENCE_MS, `${c.name} control snapshot`);
      await c.seed();
      await waitFor(() => control.some(c.matches), CONVERGENCE_MS, `${c.name} control delivery`);
    } finally {
      stopControl();
    }

    expect(seen.length).toBe(before);
  });

  const excluded = c.excluded;
  if (excluded) {
    /**
     * A keyed single-document read has no filter to narrow, but it does have a
     * key, and every other row seeds only the key it asks for — so nothing here
     * could tell "reads the document at this key" from "reads the collection".
     * The decoy is seeded FIRST, so a read at the wrong key would surface it in
     * the very first snapshot.
     */
    it(`delivers only its own key, never ${excluded.what}`, async () => {
      await excluded.seed();

      const seen: unknown[] = [];
      const errors: DomainError[] = [];
      const unsubscribe = c.subscribe(
        (d) => seen.push(d),
        (e) => errors.push(e),
      );
      try {
        await waitFor(
          () => seen.length > 0,
          CONVERGENCE_MS,
          `${c.name} initial snapshot alongside ${excluded.what}`,
          errors,
        );
        expect(seen[0]).toBeNull();

        await c.seed();
        await waitFor(() => seen.some(c.matches), CONVERGENCE_MS, `${c.name} document`, errors);

        // Every delivery is either "absent" or THIS document. The decoy is a
        // valid document of the same schema, so anything reading the wrong key
        // would have delivered a non-null value that does not match.
        expect(seen.every((d) => d === null || c.matches(d))).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        unsubscribe();
      }
    });
  }

  it(`handles a document that fails its schema by delivering ${c.onCorrupt}`, async () => {
    // Only the `'null'` rows need the rejection log: there `null` is by design
    // indistinguishable from "absent", so the log is the only thing that says the
    // document was read and refused. A `StorageError`/`corruption` is its own
    // proof and needs no backstop.
    const logged = vi.spyOn(console, 'error');
    const seen: unknown[] = [];
    const errors: DomainError[] = [];
    const unsubscribe = c.subscribe(
      (d) => seen.push(d),
      (e) => errors.push(e),
    );
    try {
      // Settle the initial (absent) snapshot first, so the null this row may
      // deliver for the corrupt document is distinguishable from that one.
      await waitFor(() => seen.length > 0, CONVERGENCE_MS, `${c.name} initial snapshot`);
      const before = seen.length;
      await c.corrupt();

      if (c.onCorrupt === 'error') {
        await waitFor(() => errors.length > 0, CONVERGENCE_MS, `${c.name} corruption error`);
        expect(errors[0]).toMatchObject({ kind: 'StorageError', reason: 'corruption' });
      } else {
        await waitFor(
          () => seen.length > before,
          CONVERGENCE_MS,
          `${c.name} delivery for the corrupt document`,
        );
        expect(seen[seen.length - 1]).toBeNull();
        expect(errors).toEqual([]);
        expect(
          logged.mock.calls.some(
            ([first]) => typeof first === 'string' && first.includes('failed validation'),
          ),
          `${c.name} delivered null without logging a rejection — indistinguishable from absent`,
        ).toBe(true);
      }
    } finally {
      unsubscribe();
    }
  });
});
