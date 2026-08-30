import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { KitchenToolDoc } from '@salt/domain/schemas';
import { success } from '@salt/shared-types';

/**
 * What `regenerateKitchenToolIcon` actually writes — a characterisation net
 * (issue #1054, Phase 1).
 *
 * WHY THIS EXISTS. `serviceWriteRefusal.test.ts` covers this command's REFUSAL
 * path — that a rejected write comes back as `err` — and nothing covers the
 * document it hands the adapter when the write succeeds. That document is the
 * whole behaviour: clearing `thumbnail` is what re-fires the icon trigger, the
 * `iconRequestedAt` nonce is what makes the clear a real write, and the ABSENCE
 * of `iconHint` is what deletes a stale steer. Phase 3 moves that field set into
 * a shared `@salt/domain` builder, so its current shape is pinned first.
 *
 * WHY ASSERTING ON THE WRITER IS RIGHT HERE (UT-A1). The written document IS the
 * observable output at this boundary — there is no rendered string and no return
 * value that carries it — so the assertion is on the payload object handed to
 * `upsertKitchenTool`, exactly as the canon and product-form icon suites assert
 * on `mockUpdate`'s argument. It is never `toHaveBeenCalled` for its own sake.
 *
 * KEY ABSENCE, NOT `undefined`. The client writes a whole-document `setDoc`, so
 * omitting the key IS the delete. `toHaveProperty` would pass for a key present
 * and undefined, so the absence is asserted with `Object.keys`.
 */

vi.mock('@salt/firebase-sync', () => ({
  subscribeKitchenTools: vi.fn(),
  upsertKitchenTool: vi.fn(),
  deleteKitchenTool: vi.fn(),
}));
vi.mock('@salt/observability', () => ({
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  initKitchenToolSync,
  regenerateKitchenToolIcon,
  unhideKitchenToolIcon,
  __resetKitchenToolServiceForTest,
} from '../src/lib/kitchenToolService.js';

const fs = vi.mocked(firebaseSync);
const NOW = '2026-01-01T00:00:00.000Z';

function makeTool(overrides: Partial<KitchenToolDoc> = {}): KitchenToolDoc {
  return {
    id: 't1',
    schemaVersion: 1,
    label: 'Mandoline',
    matchers: ['mandoline'],
    thumbnail: 'https://example.test/tool.webp',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Seed the store through the subscription, as the service's own callers do. */
function seed(tools: KitchenToolDoc[]): void {
  let emit: ((v: readonly KitchenToolDoc[]) => void) | null = null;
  fs.subscribeKitchenTools.mockImplementation(((on: (v: readonly KitchenToolDoc[]) => void) => {
    emit = on;
    return () => {};
  }) as never);
  initKitchenToolSync();
  emit!(tools);
}

/** The single document handed to the adapter. */
function written(): KitchenToolDoc {
  expect(fs.upsertKitchenTool.mock.calls).toHaveLength(1);
  return fs.upsertKitchenTool.mock.calls[0]![0] as KitchenToolDoc;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetKitchenToolServiceForTest();
  fs.upsertKitchenTool.mockResolvedValue(success(undefined));
});

afterEach(() => {
  __resetKitchenToolServiceForTest();
});

describe('regenerateKitchenToolIcon — the document it writes', () => {
  it('clears the thumbnail and stamps a fresh nonce, keeping the rest of the tool', async () => {
    const before = Date.now();
    seed([makeTool()]);

    await regenerateKitchenToolIcon('t1');

    const doc = written();
    expect(doc.thumbnail).toBeNull();
    expect(doc.iconRequestedAt).toBeGreaterThanOrEqual(before);
    expect(doc.iconRequestedAt).toBeLessThanOrEqual(Date.now());
    // Everything the tool IS survives untouched — this is a whole-document write.
    expect(doc.id).toBe('t1');
    expect(doc.label).toBe('Mandoline');
    expect(doc.matchers).toEqual(['mandoline']);
    expect(doc.createdAt).toBe(NOW);
  });

  it('writes a fresh nonce even when the thumbnail is ALREADY null', async () => {
    // The case the nonce exists for: a just-added tool whose first drawing never
    // arrived. Writing null over null mutates nothing, so without the nonce
    // Firestore emits no write event and the trigger never runs.
    seed([makeTool({ thumbnail: null })]);

    await regenerateKitchenToolIcon('t1');

    const doc = written();
    expect(doc.thumbnail).toBeNull();
    expect(typeof doc.iconRequestedAt).toBe('number');
  });

  it('stores a supplied hint, trimmed', async () => {
    seed([makeTool()]);

    await regenerateKitchenToolIcon('t1', '  a flat blade  ');

    expect(written().iconHint).toBe('a flat blade');
  });

  it('omits the hint KEY entirely when none is given', async () => {
    seed([makeTool()]);

    await regenerateKitchenToolIcon('t1');

    // Absent, not `undefined`: key omission is the delete for a whole-document write.
    expect(Object.keys(written())).not.toContain('iconHint');
  });

  it('omits the hint KEY for a whitespace-only hint', async () => {
    seed([makeTool()]);

    await regenerateKitchenToolIcon('t1', '   ');

    expect(Object.keys(written())).not.toContain('iconHint');
  });

  it('drops a pre-existing hint when regenerating without one', async () => {
    // A plain regenerate is plain, rather than silently inheriting the last steer
    // somebody typed.
    seed([makeTool({ iconHint: 'the old steer' })]);

    await regenerateKitchenToolIcon('t1');

    expect(Object.keys(written())).not.toContain('iconHint');
  });

  it('replaces a pre-existing hint with the new one', async () => {
    seed([makeTool({ iconHint: 'the old steer' })]);

    await regenerateKitchenToolIcon('t1', 'the new steer');

    expect(written().iconHint).toBe('the new steer');
  });

  it('un-hiding writes the same regenerate document, clearing the sentinel', async () => {
    // Un-hide has no write of its own — clearing the sentinel back to null IS the
    // write that re-triggers generation.
    seed([makeTool({ thumbnail: 'hidden' })]);

    await unhideKitchenToolIcon('t1');

    const doc = written();
    expect(doc.thumbnail).toBeNull();
    expect(typeof doc.iconRequestedAt).toBe('number');
    expect(Object.keys(doc)).not.toContain('iconHint');
  });

  it('answers NotFound and writes nothing for an unknown tool', async () => {
    seed([makeTool()]);

    const result = await regenerateKitchenToolIcon('ghost');

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'NotFound', resource: 'kitchenTool', id: 'ghost' },
    });
    expect(fs.upsertKitchenTool.mock.calls).toHaveLength(0);
  });
});
