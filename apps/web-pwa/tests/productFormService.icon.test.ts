import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { ProductForm } from '@salt/domain';

vi.mock('@salt/firebase-sync', () => ({
  subscribeProductForms: vi.fn(),
  upsertProductForm: vi.fn().mockResolvedValue({ kind: 'ok' as const, value: undefined }),
  deleteProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  callRegenerateProductFormIcon: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

vi.mock('@salt/observability', () => ({
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  regenerateProductFormIcon,
  hideProductFormIcon,
  unhideProductFormIcon,
  __resetProductFormServiceForTest,
} from '../src/lib/productFormService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

function makeForm(overrides: Partial<ProductForm> = {}): ProductForm {
  return {
    id: 'f1',
    schemaVersion: 1,
    matchers: ['lime juice'],
    parentCanonId: 'c-lime',
    label: 'Lime juice',
    yield: { formUnit: 'ml', amountPerParent: 30 },
    updatedAt: '',
    thumbnail: 'https://example.com/old.webp',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetProductFormServiceForTest();
});

// The twin of canonService.icon.test.ts — the point of these is the SPLIT: two of
// the three actions go through the auth'd callable (only the server may clear a
// thumbnail, because clearing is what re-fires generation), while hide is a plain
// client write. Getting that split backwards is the failure mode worth pinning.
describe('productFormService icon actions', () => {
  it('regenerateProductFormIcon calls the regenerate callable', async () => {
    const result = await regenerateProductFormIcon('form-123');
    expect(fs.callRegenerateProductFormIcon).toHaveBeenCalledWith('form-123', undefined);
    expect(result.kind).toBe('ok');
  });

  it('regenerateProductFormIcon forwards an optional hint', async () => {
    await regenerateProductFormIcon('form-123', 'show it as a bottle');
    expect(fs.callRegenerateProductFormIcon).toHaveBeenCalledWith(
      'form-123',
      'show it as a bottle',
    );
  });

  it('unhideProductFormIcon calls the regenerate callable with no hint', async () => {
    await unhideProductFormIcon('form-123');
    expect(fs.callRegenerateProductFormIcon).toHaveBeenCalledWith('form-123');
  });

  it('hideProductFormIcon upserts the form with the hidden sentinel', async () => {
    const result = await hideProductFormIcon(makeForm());
    expect(result.kind).toBe('ok');
    expect(fs.upsertProductForm).toHaveBeenCalledTimes(1);
    const upserted = fs.upsertProductForm.mock.calls[0]![0] as ProductForm;
    expect(upserted.thumbnail).toBe('hidden');
    // Does not go through the regenerate callable.
    expect(fs.callRegenerateProductFormIcon).not.toHaveBeenCalled();
  });

  it('hideProductFormIcon leaves every other field untouched', async () => {
    await hideProductFormIcon(makeForm({ label: 'Egg yolk', matchers: ['yolk'] }));
    const upserted = fs.upsertProductForm.mock.calls[0]![0] as ProductForm;
    expect(upserted.label).toBe('Egg yolk');
    expect(upserted.matchers).toEqual(['yolk']);
    expect(upserted.yield).toEqual({ formUnit: 'ml', amountPerParent: 30 });
  });
});
