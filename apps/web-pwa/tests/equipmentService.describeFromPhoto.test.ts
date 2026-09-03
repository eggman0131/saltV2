import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { EquipmentReferencePhoto } from '@salt/domain/schemas';

// describeEquipmentFromPhoto (issue #947) — "Start over, but with a picture".
// The service function's whole job is projecting (name, photo) onto the
// describeEquipmentSubject callable and handing back its ReadResult untouched;
// the busy/error handling around it lives in EquipmentEditPage's runBriefAction,
// which this is the third caller of.

vi.mock('@salt/firebase-sync', () => ({
  subscribeEquipmentManifest: vi.fn(),
  saveEquipmentManifest: vi.fn(),
  callIdentifyEquipment: vi.fn(),
  callPopulateEquipmentEntry: vi.fn(),
  subscribeEquipmentIcons: vi.fn(() => () => {}),
  callDrawEquipmentIcon: vi.fn(),
  callDescribeEquipmentSubject: vi.fn(),
}));

import * as firebaseSync from '@salt/firebase-sync';
import { describeEquipmentFromPhoto } from '../src/lib/equipmentService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const PHOTO: EquipmentReferencePhoto = { base64: 'ZmFrZS1waG90bw==', contentType: 'image/webp' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('describeEquipmentFromPhoto', () => {
  it('sends the trimmed name and the photo, nothing else', async () => {
    fs.callDescribeEquipmentSubject.mockResolvedValue({ kind: 'ok', value: 'a squat mixer' });

    const result = await describeEquipmentFromPhoto('  Kenwood Chef KVC3100S  ', PHOTO);

    expect(result).toEqual({ kind: 'ok', value: 'a squat mixer' });
    expect(fs.callDescribeEquipmentSubject).toHaveBeenCalledWith({
      name: 'Kenwood Chef KVC3100S',
      photo: PHOTO,
    });
  });

  it('sends no currentBrief or hint — a photo always authors from scratch', async () => {
    fs.callDescribeEquipmentSubject.mockResolvedValue({ kind: 'ok', value: 'x' });

    await describeEquipmentFromPhoto('Kenwood Chef KVC3100S', PHOTO);

    const [input] = fs.callDescribeEquipmentSubject.mock.calls[0]!;
    expect(input).not.toHaveProperty('currentBrief');
    expect(input).not.toHaveProperty('hint');
  });

  it('passes a callable failure straight through', async () => {
    fs.callDescribeEquipmentSubject.mockResolvedValue({
      kind: 'err',
      error: { kind: 'ValidationError', code: 'EQUIPMENT_BRIEF_NOT_WRITABLE' },
    });

    const result = await describeEquipmentFromPhoto('Kenwood Chef KVC3100S', PHOTO);

    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'ValidationError', code: 'EQUIPMENT_BRIEF_NOT_WRITABLE' },
    });
  });
});
