/**
 * Emulator integration test for onShoppingListItemWrite.
 *
 * Tests that the trigger correctly writes canonId + matchState back to the
 * Firestore document when called with a synthetic event. The Firestore Admin
 * SDK is used for real reads/writes against the emulator; domain logic is
 * mocked so the test focuses on the Firestore plumbing.
 *
 * Requires the Firestore emulator reachable on the port injected by
 * vitest.emulator.config.ts `test.env` (issue #84, Phase 3 — the isolated
 * Vitest stack); falls back to the dev port 8080 for an ad-hoc run.
 * Run via: pnpm test:emulator
 */

// Point the Admin SDK at the Firestore emulator before any imports. The port
// comes from the isolated Vitest stack (injected via test.env) so this no
// longer pins to the dev emulator (8080 stays only as the ad-hoc fallback).
process.env['FIRESTORE_EMULATOR_HOST'] =
  `127.0.0.1:${process.env['VITE_EMULATOR_FIRESTORE_PORT'] ?? '8080'}`;

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { CanonItem } from '@salt/domain';

// ─── Mocks (everything except firebase-admin/firestore) ──────────────────────

vi.mock('firebase-functions/firestore', () => ({
  onDocumentWritten: (_path: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@salt/observability/server', () => ({
  startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })),
  flushServerObservability: vi.fn().mockResolvedValue(undefined),
  whenServerObservabilityReady: vi.fn().mockResolvedValue(undefined),
  initServerObservability: vi.fn(),
  isServerObservabilityInitialised: vi.fn(() => false),
  // Phase 5: the trigger trace-context helper (triggerTraceContext.ts) is not
  // mocked, so it resolves the REAL runWithSuppliedTraceContext from here — it
  // must exist. Just run the fn (no real OTel context in the isolated stack).
  runWithSuppliedTraceContext: vi.fn(<T>(_traceparent: string | undefined, fn: () => T): T => fn()),
  createServerObservabilityMatchLoggingAdapter: vi.fn(() => ({
    write: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockMatchOrCreate = vi.fn();
vi.mock('@salt/domain', async (importOriginal) => {
  const original = await importOriginal<typeof import('@salt/domain')>();
  return { ...original, matchOrCreate: mockMatchOrCreate };
});

vi.mock('../../src/flows/matchOrCreateCanon.js', () => ({
  buildMatchOrCreatePorts: vi.fn(() => ({})),
}));

const { onShoppingListItemWrite } = await import('../../src/triggers/onShoppingListItemWrite.js');

// ─── Setup ───────────────────────────────────────────────────────────────────

const PROJECT_ID = 'demo-salt';
// Single source: the host resolved above for the Admin SDK is reused for the
// REST clear endpoint so both hit the same (Vitest stack) emulator.
const EMULATOR_HOST = process.env['FIRESTORE_EMULATOR_HOST'] as string;

let adminApp: App;

function makeCanonItem(id: string, needsApproval = false): CanonItem {
  return {
    id,
    schemaVersion: 5,
    name: 'Baked Beans',
    synonyms: [],
    aisleId: 'tinned',
    thumbnail: null,
    embedding: null,
    needs_approval: needsApproval,
    shoppingBehavior: 'needed',
    updatedAt: new Date().toISOString(),
  };
}

async function clearEmulator(): Promise<void> {
  const url = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Failed to clear emulator: HTTP ${resp.status}`);
  }
}

function makeEvent({
  before,
  after,
  listId = 'emulator-list',
  itemId = 'emulator-item',
}: {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  listId?: string;
  itemId?: string;
}) {
  return {
    params: { listId, itemId },
    data: {
      before: before
        ? { exists: true, data: () => before }
        : { exists: false, data: () => undefined },
      after: after ? { exists: true, data: () => after } : { exists: false, data: () => undefined },
    },
  };
}

beforeAll(() => {
  // Default (unnamed) app: the trigger acquires Firestore via getFirestore()
  // with no app argument, so the test must seed/assert through the same
  // default app or the handler throws "default Firebase app does not exist".
  adminApp = initializeApp({ projectId: PROJECT_ID });
});

afterAll(async () => {
  await deleteApp(adminApp);
});

beforeEach(async () => {
  await clearEmulator();
  vi.clearAllMocks();
  mockMatchOrCreate.mockReset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('onShoppingListItemWrite — Firestore emulator', () => {
  it('writes canonId and matchState: matched back to the item doc', async () => {
    mockMatchOrCreate.mockResolvedValue({
      kind: 'ok',
      value: { decision: 'matched', item: makeCanonItem('canon-beans', false) },
    });

    const db = getFirestore(adminApp);
    const docRef = db
      .collection('shoppingLists')
      .doc('emulator-list')
      .collection('items')
      .doc('emulator-item');

    // Write initial pending item directly.
    await docRef.set({
      id: 'emulator-item',
      rawText: 'heinz baked beans',
      notes: '',
      canonId: null,
      matchState: 'pending',
      checked: false,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const event = makeEvent({
      before: null,
      after: {
        id: 'emulator-item',
        rawText: 'heinz baked beans',
        canonId: null,
        matchState: 'pending',
      },
    });

    await (onShoppingListItemWrite as Function)(event);

    const snap = await docRef.get();
    expect(snap.exists).toBe(true);
    const data = snap.data()!;
    expect(data['canonId']).toBe('canon-beans');
    expect(data['matchState']).toBe('matched');
  });

  it('writes matchState: needs_approval when canon has needs_approval: true', async () => {
    mockMatchOrCreate.mockResolvedValue({
      kind: 'ok',
      value: { decision: 'created', item: makeCanonItem('canon-new', true) },
    });

    const db = getFirestore(adminApp);
    const docRef = db
      .collection('shoppingLists')
      .doc('emulator-list')
      .collection('items')
      .doc('emulator-item');

    await docRef.set({
      id: 'emulator-item',
      rawText: 'obscure ingredient',
      notes: '',
      canonId: null,
      matchState: 'pending',
      checked: false,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const event = makeEvent({
      before: null,
      after: { rawText: 'obscure ingredient', canonId: null, matchState: 'pending' },
    });

    await (onShoppingListItemWrite as Function)(event);

    const snap = await docRef.get();
    expect(snap.data()!['matchState']).toBe('needs_approval');
    expect(snap.data()!['canonId']).toBe('canon-new');
  });

  it('writes matchState: failed when matchOrCreate returns an error', async () => {
    mockMatchOrCreate.mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    });

    const db = getFirestore(adminApp);
    const docRef = db
      .collection('shoppingLists')
      .doc('emulator-list')
      .collection('items')
      .doc('emulator-item');

    await docRef.set({
      rawText: 'thing',
      canonId: null,
      matchState: 'pending',
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const event = makeEvent({
      before: null,
      after: { rawText: 'thing', canonId: null, matchState: 'pending' },
    });

    await (onShoppingListItemWrite as Function)(event);

    const snap = await docRef.get();
    expect(snap.data()!['matchState']).toBe('failed');
  });

  it('does not modify the doc on a notes-only edit', async () => {
    const db = getFirestore(adminApp);
    const docRef = db
      .collection('shoppingLists')
      .doc('emulator-list')
      .collection('items')
      .doc('emulator-item');

    const initial = {
      rawText: 'milk',
      canonId: null,
      matchState: 'pending',
      notes: '',
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
    };
    await docRef.set(initial);

    const event = makeEvent({
      before: { rawText: 'milk', canonId: null, matchState: 'pending', notes: '' },
      after: { rawText: 'milk', canonId: null, matchState: 'pending', notes: 'organic' },
    });

    await (onShoppingListItemWrite as Function)(event);

    // matchOrCreate must not have been called; doc should be unchanged.
    expect(mockMatchOrCreate).not.toHaveBeenCalled();
    const snap = await docRef.get();
    expect(snap.data()!['notes']).toBe('');
  });
});
