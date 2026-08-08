/**
 * Firestore emulator integration tests for the purchase-count writes (#726).
 *
 * The unit tests pin the SHAPE of the write (one merged setDoc, one transform
 * per id). What only a real Firestore can prove is that the shape actually
 * behaves: that the very first tick-off CREATES the document rather than being
 * rejected the way `updateDoc` would reject it, that repeated gestures
 * ACCUMULATE server-side instead of overwriting, and that merging one gesture's
 * ids does not wipe the ids another gesture wrote.
 *
 * Requires the isolated Vitest emulator stack (issue #84 Phase 3).
 * Run via: pnpm test:emulator
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { recordCanonPurchases, loadCanonPurchaseCounts } from '../src/canonPurchaseSync.js';
import { clearFirestoreEmulator, resetDefaultApp } from './emulatorHelpers.js';

beforeEach(async () => {
  await clearFirestoreEmulator();
  await resetDefaultApp();
});

async function counts(): Promise<Record<string, number>> {
  const result = await loadCanonPurchaseCounts();
  if (result.kind !== 'ok') throw new Error(`load failed: ${JSON.stringify(result.error)}`);
  return result.value.counts;
}

describe('canonPurchaseSync — Firestore emulator', () => {
  it('reads an absent document as empty counts', async () => {
    await expect(counts()).resolves.toEqual({});
  });

  it('creates the document on the first ever tick-off', async () => {
    const result = await recordCanonPurchases(['canon-onion']);

    expect(result).toEqual({ kind: 'ok', value: undefined });
    await expect(counts()).resolves.toEqual({ 'canon-onion': 1 });
  });

  it('accumulates across gestures rather than overwriting', async () => {
    await recordCanonPurchases(['canon-onion']);
    await recordCanonPurchases(['canon-onion']);
    await recordCanonPurchases(['canon-onion']);

    await expect(counts()).resolves.toEqual({ 'canon-onion': 3 });
  });

  it('applies a repeated id within one gesture as a single +2', async () => {
    await recordCanonPurchases(['canon-onion', 'canon-onion']);

    await expect(counts()).resolves.toEqual({ 'canon-onion': 2 });
  });

  it('merges a new gesture into the existing map without clearing other ids', async () => {
    await recordCanonPurchases(['canon-onion', 'canon-milk']);
    await recordCanonPurchases(['canon-milk', 'canon-leek']);

    await expect(counts()).resolves.toEqual({
      'canon-onion': 1,
      'canon-milk': 2,
      'canon-leek': 1,
    });
  });

  it('stamps lastAt for every id the gesture carried, and refreshes it on the next', async () => {
    await recordCanonPurchases(['canon-onion', 'canon-milk']);
    const first = await loadCanonPurchaseCounts();
    if (first.kind !== 'ok') throw new Error('load failed');
    const firstOnion = first.value.lastAt['canon-onion'];

    await recordCanonPurchases(['canon-onion']);
    const second = await loadCanonPurchaseCounts();
    if (second.kind !== 'ok') throw new Error('load failed');

    expect(Object.keys(second.value.lastAt).sort()).toEqual(['canon-milk', 'canon-onion']);
    // The untouched id keeps its stamp; the ticked one is at least as recent.
    expect(second.value.lastAt['canon-milk']).toBe(first.value.lastAt['canon-milk']);
    expect(new Date(second.value.lastAt['canon-onion']!).getTime()).toBeGreaterThanOrEqual(
      new Date(firstOnion!).getTime(),
    );
  });
});
