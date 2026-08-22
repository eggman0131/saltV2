import { describe, it, expect } from 'vitest';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import type { ProductFormDoc } from '@salt/domain/schemas';
import { iconNeedsGeneration } from '../../src/triggers/onProductFormWritten.js';

// The edge-trigger guard is the whole correctness story of this trigger: it fires
// on EVERY write to the form, and the admin catalog saves field-by-field on blur,
// so "generate whenever the thumbnail happens to be null" would start a fresh
// image generation on each keystroke-blur while the first one is still in flight.
// These pin the transitions, not the states.

function form(overrides: Partial<ProductFormDoc> = {}): ProductFormDoc {
  return {
    id: 'f1',
    schemaVersion: 1,
    matchers: ['lime juice'],
    parentCanonId: 'c-lime',
    label: 'Lime juice',
    yield: { formUnit: 'ml', amountPerParent: 30 },
    updatedAt: '',
    thumbnail: null,
    ...overrides,
  };
}

/** A minimal stand-in for the `before` snapshot: only `exists` and `data()` are read. */
function snapshot(data: Record<string, unknown> | null): DocumentSnapshot {
  return {
    exists: data !== null,
    data: () => data ?? undefined,
  } as unknown as DocumentSnapshot;
}

describe('onProductFormWritten — iconNeedsGeneration', () => {
  it('generates on create', () => {
    expect(iconNeedsGeneration(undefined, form())).toBe(true);
    expect(iconNeedsGeneration(snapshot(null), form())).toBe(true);
  });

  it('skips when an icon already exists', () => {
    const after = form({ thumbnail: 'https://example.com/lime-juice.webp' });
    expect(iconNeedsGeneration(undefined, after)).toBe(false);
    expect(iconNeedsGeneration(snapshot({ thumbnail: null }), after)).toBe(false);
  });

  it('skips forever once the user has hidden the icon', () => {
    const after = form({ thumbnail: 'hidden' });
    expect(iconNeedsGeneration(snapshot({ thumbnail: null }), after)).toBe(false);
  });

  it('generates when the icon was just cleared', () => {
    const before = snapshot({ thumbnail: 'https://example.com/old.webp' });
    expect(iconNeedsGeneration(before, form())).toBe(true);
  });

  it('does NOT generate on an unrelated edit while a generation is in flight', () => {
    // thumbnail was already null and stayed null — the write that first set it
    // null owns the in-flight generation. This is the duplicate-generation guard.
    const before = snapshot({ thumbnail: null, label: 'Lime juice' });
    expect(iconNeedsGeneration(before, form({ label: 'Fresh lime juice' }))).toBe(false);
  });

  it('generates when the regenerate nonce changes on an already-iconless form', () => {
    const before = snapshot({ thumbnail: null, iconRequestedAt: 1 });
    expect(iconNeedsGeneration(before, form({ iconRequestedAt: 2 }))).toBe(true);
  });

  it('does not re-generate when the nonce is unchanged', () => {
    const before = snapshot({ thumbnail: null, iconRequestedAt: 7 });
    expect(iconNeedsGeneration(before, form({ iconRequestedAt: 7 }))).toBe(false);
  });

  // The back-compat case, and the reason the guard reads `prev?.['thumbnail'] ?? null`
  // rather than the raw value: a form written before issue #871 has NO thumbnail key.
  // The schema default gives `after.thumbnail === null`, so reading the absent
  // `before` value as anything other than null would look like "just cleared" and
  // fire a generation for every legacy form on its next unrelated edit.
  it('treats a pre-icon doc with no thumbnail key as already-null, not just-cleared', () => {
    const before = snapshot({ label: 'Lime juice', matchers: ['lime juice'] });
    expect(iconNeedsGeneration(before, form({ label: 'Fresh lime juice' }))).toBe(false);
  });

  it('still lets an explicit regenerate reach a pre-icon doc', () => {
    const before = snapshot({ label: 'Lime juice' });
    expect(iconNeedsGeneration(before, form({ iconRequestedAt: 123 }))).toBe(true);
  });
});
