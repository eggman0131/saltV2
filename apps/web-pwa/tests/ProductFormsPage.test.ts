import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Member, ProductForm } from '@salt/domain';

const {
  mockProductForms,
  mockIsLoadingProductForms,
  mockCanonItems,
  mockMembers,
  mockIsLoadingMembers,
  mockAuth,
} = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) {
        subs.add(fn);
        fn(value);
        return () => {
          subs.delete(fn);
        };
      },
      _set(v: T) {
        value = v;
        subs.forEach((fn) => fn(v));
      },
    };
  }
  return {
    mockProductForms: makeStore<ProductForm[]>([]),
    mockIsLoadingProductForms: makeStore<boolean>(false),
    mockCanonItems: makeStore<{ id: string; name: string; needs_approval?: boolean }[]>([]),
    mockMembers: makeStore<Member[]>([]),
    mockIsLoadingMembers: makeStore<boolean>(false),
    mockAuth: { user: { email: 'admin@e.org' } as { email: string } | null },
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
// Deferred delete only commits when the Undo toast LAPSES (its `onDismiss`), so a
// bare vi.fn() toast would strand the commit and hang the test. Lapse immediately.
vi.mock('../src/lib/toastStore.js', () => ({
  addToast: vi.fn((_msg: string, _variant?: string, opts?: { onDismiss?: () => void }) => {
    opts?.onDismiss?.();
  }),
}));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));
vi.mock('../src/lib/membersService.js', () => ({
  members: mockMembers,
  isLoadingMembers: mockIsLoadingMembers,
}));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));
vi.mock('../src/lib/productFormService.js', () => ({
  productForms: mockProductForms,
  isLoadingProductForms: mockIsLoadingProductForms,
  deleteProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import ProductFormsPage from '../src/routes/admin/ProductFormsPage.svelte';
import { deleteProductForm } from '../src/lib/productFormService.js';
import { addToast } from '../src/lib/toastStore.js';

const ADMIN: Member = {
  schemaVersion: 1,
  id: 'admin@e.org',
  name: 'Ada Admin',
  email: 'admin@e.org',
  admin: true,
  sortOrder: 0,
  icon: null,
  updatedAt: '2026-07-17T00:00:00.000Z',
};

function form(overrides: Partial<ProductForm> & { id: string }): ProductForm {
  return {
    schemaVersion: 1,
    matchers: ['lime zest'],
    parentCanonId: 'canon-lime',
    label: 'Lime zest',
    yield: { formUnit: 'g', amountPerParent: 5 },
    needs_approval: false,
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

const ZEST = form({ id: 'form-1', label: 'Lime zest' });
const JUICE = form({ id: 'form-2', label: 'Lemon juice', matchers: ['lemon juice'] });

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.body.style.pointerEvents = '';
  mockProductForms._set([]);
  mockCanonItems._set([]);
  vi.clearAllMocks();
});

describe('ProductFormsPage', () => {
  it('offers a Select toggle like every other list view', async () => {
    mockMembers._set([ADMIN]);
    mockCanonItems._set([{ id: 'canon-lime', name: 'Lime' }]);
    mockProductForms._set([ZEST, JUICE]);

    render(ProductFormsPage);

    expect(await screen.findByRole('button', { name: 'Select' })).toBeTruthy();
  });

  it('deletes the selected forms via the bulk action', async () => {
    mockMembers._set([ADMIN]);
    mockCanonItems._set([{ id: 'canon-lime', name: 'Lime' }]);
    mockProductForms._set([ZEST, JUICE]);

    render(ProductFormsPage);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Select' }));

    // Checkboxes only render in selection mode; the select-all sits first. Rows
    // sort alphabetically by label, so "Lemon juice" (JUICE) precedes "Lime zest".
    const checkboxes = await screen.findAllByRole('checkbox');
    expect(checkboxes.length).toBe(3); // select-all + one per row
    await user.click(checkboxes[1]!);

    await user.click(await screen.findByTestId('product-forms-bulk-delete'));

    await waitFor(() => {
      expect(vi.mocked(deleteProductForm)).toHaveBeenCalledOnce();
    });
    // Only the selected row is deleted — the other form is untouched.
    expect(vi.mocked(deleteProductForm)).toHaveBeenCalledWith(JUICE.id);
  });

  it('labels the undo toast with "form", not the generic "item"', async () => {
    mockMembers._set([ADMIN]);
    mockCanonItems._set([{ id: 'canon-lime', name: 'Lime' }]);
    mockProductForms._set([ZEST, JUICE]);

    render(ProductFormsPage);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Select' }));
    const checkboxes = await screen.findAllByRole('checkbox');
    await user.click(checkboxes[1]!);
    await user.click(await screen.findByTestId('product-forms-bulk-delete'));

    await waitFor(() => {
      expect(vi.mocked(addToast)).toHaveBeenCalledWith(
        '1 form deleted',
        'default',
        expect.anything(),
      );
    });
  });
});
