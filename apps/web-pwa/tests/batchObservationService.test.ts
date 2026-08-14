import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import type { BatchObservationDoc } from '@salt/domain/schemas';

// The observation log's write path (issue #812, phase 4 of epic #778).
//
// Three things this service exists to get right, and all three are asserted here
// rather than left to a screen:
//
//   • IT MINTS THE ID AND THE INSTANT (CLAUDE.md Rule 1 — the domain mints neither).
//     The id is also the document id, which is what makes correcting an entry a
//     re-write rather than a delete-and-re-add.
//   • THE TWO WRITES GO IN ONE ORDER. The entry first, the photo second, because the
//     callable finishes with a partial update and a partial update of an absent
//     document fails.
//   • A FAILED UPLOAD COSTS THE PHOTO AND NEVER THE READING. The result is the
//     reading's; the photo's fate is reported separately inside a SUCCESS.

vi.mock('@salt/firebase-sync', () => ({
  subscribeBatchObservations: vi.fn(() => () => {}),
  addBatchObservation: vi.fn(async () => ({ kind: 'ok', value: undefined })),
  callSetObservationImageUpload: vi.fn(async () => ({ kind: 'ok', value: undefined })),
  isAuthTransitioning: vi.fn(() => false),
}));

vi.mock('@salt/observability', () => ({
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  observations,
  initBatchObservationsSync,
  logObservation,
} from '../src/lib/batchObservationService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const BATCH_ID = 'batch-1';

function writtenObservation(call = 0): BatchObservationDoc {
  const args = fs.addBatchObservation.mock.calls[call];
  if (!args) throw new Error('addBatchObservation was not called');
  return args[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.subscribeBatchObservations.mockImplementation(() => () => {});
  fs.addBatchObservation.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.callSetObservationImageUpload.mockResolvedValue({ kind: 'ok', value: undefined });
});

describe('batchObservationService — the subscription', () => {
  it('resets to not-loaded on init, so one run never shows another’s readings', () => {
    initBatchObservationsSync(BATCH_ID);
    expect(get(observations)).toBeUndefined();
    expect(fs.subscribeBatchObservations).toHaveBeenCalledWith(
      BATCH_ID,
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('publishes the adapter’s list exactly as delivered, in its order', () => {
    // `orderBy('at', 'asc')` is the adapter's and is not re-done here: a service that
    // re-sorted could disagree with the query, and arrival order would quietly make a
    // cure's curve wrong.
    const delivered: BatchObservationDoc[] = [
      {
        id: 'obs-tuesday',
        schemaVersion: 1,
        at: '2026-08-11T08:00:00.000Z',
        weightGrams: 1440,
        ph: null,
        temperatureC: null,
        note: '',
        image: null,
      },
      {
        id: 'obs-thursday',
        schemaVersion: 1,
        at: '2026-08-13T08:00:00.000Z',
        weightGrams: 1402,
        ph: null,
        temperatureC: null,
        note: '',
        image: null,
      },
    ];
    initBatchObservationsSync(BATCH_ID);
    const onObservations = fs.subscribeBatchObservations.mock.calls[0]![1];
    onObservations(delivered);

    expect(get(observations)).toEqual(delivered);
  });

  it('hands the unsub straight back', () => {
    const unsub = vi.fn();
    fs.subscribeBatchObservations.mockReturnValue(unsub);
    expect(initBatchObservationsSync(BATCH_ID)).toBe(unsub);
  });
});

describe('batchObservationService — logging a reading', () => {
  it('mints the id and the instant, and writes them onto the entry', async () => {
    const before = Date.now();
    const result = await logObservation({
      batchId: BATCH_ID,
      weightGrams: 1440,
      note: 'open crumb',
    });
    const after = Date.now();

    expect(result.kind).toBe('ok');
    const doc = writtenObservation();
    expect(doc.id).toMatch(/[0-9a-f-]{16,}/i);
    expect(fs.addBatchObservation).toHaveBeenCalledWith(BATCH_ID, doc);
    // The document id IS the observation id — that is what makes a correction a
    // re-write of the same entry.
    expect(result.kind === 'ok' && result.value.observationId).toBe(doc.id);
    // The clock is read HERE and nowhere else in this feature's log path.
    const at = new Date(doc.at).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
  });

  it('mints a fresh id every time, so two readings can never collide', async () => {
    await logObservation({ batchId: BATCH_ID, weightGrams: 1440, note: '' });
    await logObservation({ batchId: BATCH_ID, weightGrams: 1438, note: '' });

    expect(writtenObservation(0).id).not.toBe(writtenObservation(1).id);
  });

  it('writes the fields it collects and nulls the two it does not', async () => {
    await logObservation({ batchId: BATCH_ID, weightGrams: 1440, note: 'open crumb' });

    expect(writtenObservation()).toMatchObject({
      schemaVersion: 1,
      weightGrams: 1440,
      note: 'open crumb',
      // No screen asks for these yet; null is what "not measured" is.
      ph: null,
      temperatureC: null,
      // The photo never travels through the document — the callable stamps it on.
      image: null,
    });
  });

  it('writes the entry BEFORE attaching the photo', async () => {
    // Forced, not stylistic: the callable finishes with a partial update, and a
    // partial update of an absent document fails.
    const order: string[] = [];
    fs.addBatchObservation.mockImplementation(async () => {
      order.push('entry');
      return { kind: 'ok', value: undefined };
    });
    fs.callSetObservationImageUpload.mockImplementation(async () => {
      order.push('photo');
      return { kind: 'ok', value: undefined };
    });

    const result = await logObservation({
      batchId: BATCH_ID,
      weightGrams: null,
      note: '',
      photoBase64: 'AAAA',
    });

    expect(order).toEqual(['entry', 'photo']);
    expect(fs.callSetObservationImageUpload).toHaveBeenCalledWith(
      BATCH_ID,
      writtenObservation().id,
      'AAAA',
      'image/webp',
    );
    expect(result.kind === 'ok' && result.value.photo.kind).toBe('attached');
  });

  it('calls no callable at all when there is no photo', async () => {
    const result = await logObservation({ batchId: BATCH_ID, weightGrams: 1440, note: '' });

    expect(fs.callSetObservationImageUpload).not.toHaveBeenCalled();
    expect(result.kind === 'ok' && result.value.photo.kind).toBe('none');
  });

  it('keeps the reading when the photo will not upload, and says so separately', async () => {
    // The whole point of the ordering. By the time an upload can fail the entry is
    // already in the log, so this is a SUCCESS whose photo failed — never an error
    // that would imply the weight was lost.
    fs.callSetObservationImageUpload.mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    });

    const result = await logObservation({
      batchId: BATCH_ID,
      weightGrams: 1440,
      note: 'open crumb',
      photoBase64: 'AAAA',
    });

    expect(fs.addBatchObservation).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && result.value.photo).toEqual({
      kind: 'failed',
      error: { kind: 'NetworkError', reason: 'transient' },
    });
  });

  it('never tries the photo when the entry itself did not land', async () => {
    // Nothing to attach it to, and a partial update of an absent document fails.
    fs.addBatchObservation.mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });

    const result = await logObservation({
      batchId: BATCH_ID,
      weightGrams: 1440,
      note: '',
      photoBase64: 'AAAA',
    });

    expect(fs.callSetObservationImageUpload).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'err', error: { kind: 'NetworkError', reason: 'offline' } });
  });

  it('appends rather than replacing — two readings are two documents', async () => {
    // The subcollection is what makes two people logging on the same day safe. This
    // service must never gather them up: one call, one document, one id.
    await logObservation({ batchId: BATCH_ID, weightGrams: 1440, note: 'hers' });
    await logObservation({ batchId: BATCH_ID, weightGrams: 1438, note: 'his' });

    expect(fs.addBatchObservation).toHaveBeenCalledTimes(2);
    expect(writtenObservation(0).note).toBe('hers');
    expect(writtenObservation(1).note).toBe('his');
  });
});
