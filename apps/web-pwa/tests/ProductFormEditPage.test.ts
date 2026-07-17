import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import type { Member, ProductForm } from '@salt/domain';

const { mockProductForms, mockCanonItems, mockMembers, mockIsLoadingMembers, mockAuth } =
  vi.hoisted(() => {
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
      mockCanonItems: makeStore<{ id: string; name: string; needs_approval?: boolean }[]>([]),
      mockMembers: makeStore<Member[]>([]),
      mockIsLoadingMembers: makeStore<boolean>(false),
      mockAuth: { user: { email: 'admin@e.org' } as { email: string } | null },
    };
  });

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));
vi.mock('../src/lib/membersService.js', () => ({
  members: mockMembers,
  isLoadingMembers: mockIsLoadingMembers,
}));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));
vi.mock('../src/lib/productFormService.js', () => ({
  productForms: mockProductForms,
  addProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  editProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  confirmProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import ProductFormEditPage from '../src/routes/admin/ProductFormEditPage.svelte';

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

const LIME_ZEST: ProductForm = {
  schemaVersion: 1,
  id: 'form-1',
  matchers: ['lime zest'],
  parentCanonId: 'canon-lime',
  label: 'Lime zest',
  yield: { formUnit: 'g', amountPerParent: 5 },
  needs_approval: false,
  updatedAt: '2026-07-17T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  mockProductForms._set([]);
  mockCanonItems._set([]);
});

describe('ProductFormEditPage', () => {
  it('renders the add form when the router passes no params', async () => {
    // The /admin/product-forms/new route is STATIC, so svelte-spa-router mounts this
    // page with NO `params` prop at all. Dereferencing `params.id` here used to throw
    // on mount and hang the page on its route-loading spinner (add-form was dead).
    mockMembers._set([ADMIN]);
    mockCanonItems._set([{ id: 'canon-lime', name: 'Lime' }]);

    render(ProductFormEditPage);

    await waitFor(() => {
      expect(screen.getByText('Add product form')).toBeTruthy();
    });
    // The delete action only belongs to an existing form.
    expect(screen.queryByTestId('product-form-delete-button')).toBeNull();
  });

  it('renders the edit form when the router passes an id param', async () => {
    mockMembers._set([ADMIN]);
    mockCanonItems._set([{ id: 'canon-lime', name: 'Lime' }]);
    mockProductForms._set([LIME_ZEST]);

    render(ProductFormEditPage, { props: { params: { id: 'form-1' } } });

    await waitFor(() => {
      expect(screen.getByTestId('product-form-delete-button')).toBeTruthy();
    });
  });

  it('reports a missing form rather than crashing on an unknown id', async () => {
    mockMembers._set([ADMIN]);

    render(ProductFormEditPage, { props: { params: { id: 'nope' } } });

    await waitFor(() => {
      expect(screen.getByText('Form not found.')).toBeTruthy();
    });
  });
});
