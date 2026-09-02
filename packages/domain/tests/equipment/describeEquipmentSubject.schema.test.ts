import { describe, it, expect } from 'vitest';
import {
  DescribeEquipmentSubjectInputSchema,
  EquipmentReferencePhotoSchema,
  EQUIPMENT_REFERENCE_PHOTO_MAX_BASE64_LENGTH,
} from '../../src/schemas/describeEquipmentSubject.js';

// The wire contract for the describeEquipmentSubject callable (issue #885). It is
// a trust boundary — the browser's Revise and Start over both post to it — so the
// caps and the optionality are what the callable rejects on, not decoration.

describe('DescribeEquipmentSubjectInputSchema', () => {
  it('accepts the name alone — what the trigger and "Start over" both send', () => {
    const parsed = DescribeEquipmentSubjectInputSchema.safeParse({ name: 'Kenwood Chef KVC3100S' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.currentBrief).toBeUndefined();
    expect(parsed.success && parsed.data.hint).toBeUndefined();
  });

  it('accepts a revision — both halves together', () => {
    const parsed = DescribeEquipmentSubjectInputSchema.safeParse({
      name: 'Kenwood Chef KVC3100S',
      currentBrief: 'A tilt-head stand mixer with a cream enamel body.',
      hint: "it's matte black",
    });
    expect(parsed.success).toBe(true);
  });

  it('requires a name — there is nothing to describe without one', () => {
    expect(DescribeEquipmentSubjectInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(DescribeEquipmentSubjectInputSchema.safeParse({}).success).toBe(false);
  });

  it('caps the brief at 2000 and the correction at 200, mirroring the recipe schema', () => {
    const name = 'Kenwood Chef KVC3100S';
    expect(
      DescribeEquipmentSubjectInputSchema.safeParse({ name, currentBrief: 'x'.repeat(2000) })
        .success,
    ).toBe(true);
    expect(
      DescribeEquipmentSubjectInputSchema.safeParse({ name, currentBrief: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      DescribeEquipmentSubjectInputSchema.safeParse({ name, hint: 'x'.repeat(200) }).success,
    ).toBe(true);
    expect(
      DescribeEquipmentSubjectInputSchema.safeParse({ name, hint: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('trims both, so whitespace alone is not half a revision', () => {
    const parsed = DescribeEquipmentSubjectInputSchema.safeParse({
      name: 'Kenwood Chef KVC3100S',
      currentBrief: '  a mixer  ',
      hint: '   ',
    });
    expect(parsed.success && parsed.data.currentBrief).toBe('a mixer');
    expect(parsed.success && parsed.data.hint).toBe('');
  });

  // ─── Photo mode (issue #947) ─────────────────────────────────────────────
  it('accepts a photo alongside the name — what "Use a photo" sends', () => {
    const parsed = DescribeEquipmentSubjectInputSchema.safeParse({
      name: 'Kenwood Chef KVC3100S',
      photo: { base64: 'ZmFrZQ==', contentType: 'image/webp' },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a photo with an unsupported content type', () => {
    const parsed = DescribeEquipmentSubjectInputSchema.safeParse({
      name: 'Kenwood Chef KVC3100S',
      photo: { base64: 'ZmFrZQ==', contentType: 'image/gif' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty photo payload', () => {
    const parsed = DescribeEquipmentSubjectInputSchema.safeParse({
      name: 'Kenwood Chef KVC3100S',
      photo: { base64: '', contentType: 'image/webp' },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('EquipmentReferencePhotoSchema', () => {
  it('caps the base64 payload — a trust boundary that cannot rely on client discipline', () => {
    expect(
      EquipmentReferencePhotoSchema.safeParse({
        base64: 'x'.repeat(EQUIPMENT_REFERENCE_PHOTO_MAX_BASE64_LENGTH),
        contentType: 'image/webp',
      }).success,
    ).toBe(true);
    expect(
      EquipmentReferencePhotoSchema.safeParse({
        base64: 'x'.repeat(EQUIPMENT_REFERENCE_PHOTO_MAX_BASE64_LENGTH + 1),
        contentType: 'image/webp',
      }).success,
    ).toBe(false);
  });

  it('accepts the same content-type enum as the recipe photo path — one convention, not a third', () => {
    for (const contentType of ['image/webp', 'image/jpeg', 'image/png'] as const) {
      expect(
        EquipmentReferencePhotoSchema.safeParse({ base64: 'ZmFrZQ==', contentType }).success,
      ).toBe(true);
    }
  });
});
