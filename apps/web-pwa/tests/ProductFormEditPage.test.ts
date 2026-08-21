import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import type { Member, ProductForm } from '@salt/domain';

const {
  mockProductForms,
  mockCanonItems,
  mockMembers,
  mockIsLoadingMembers,
  mockAuth,
  mockRouter,
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
    mockCanonItems: makeStore<{ id: string; name: string; needs_approval?: boolean }[]>([]),
    mockMembers: makeStore<Member[]>([]),
    mockIsLoadingMembers: makeStore<boolean>(false),
    mockAuth: { user: { email: 'admin@e.org' } as { email: string } | null },
    // svelte-spa-router's `router` is a rune-backed state object; the page reads
    // `router.querystring` to seed `?parent=` on the create path (#872).
    mockRouter: { querystring: '' as string | undefined },
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn(), router: mockRouter }));
// Delete is deferred (#872) and only commits when the Undo toast LAPSES, via the
// toast's own `onDismiss`. A bare vi.fn() would strand the commit — lapse now.
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
  addProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  editProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  confirmProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteProductForm: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import ProductFormEditPage from '../src/routes/admin/ProductFormEditPage.svelte';
import { push } from 'svelte-spa-router';
import { addToast } from '../src/lib/toastStore.js';
import {
  addProductForm,
  editProductForm,
  confirmProductForm,
  deleteProductForm,
} from '../src/lib/productFormService.js';

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

function renderEdit(form: ProductForm = LIME_ZEST) {
  mockMembers._set([ADMIN]);
  mockCanonItems._set([{ id: 'canon-lime', name: 'Lime' }]);
  mockProductForms._set([form]);
  return render(ProductFormEditPage, { props: { params: { id: form.id } } });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.body.style.pointerEvents = '';
  mockProductForms._set([]);
  mockCanonItems._set([]);
  mockRouter.querystring = '';
  vi.clearAllMocks();
});

describe('ProductFormEditPage — create', () => {
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

  // Creating is a consequence, so it keeps an explicit button — there is no
  // record to autosave into (#872, D2).
  it('keeps an explicit create action and writes only when it is pressed', async () => {
    mockMembers._set([ADMIN]);
    mockCanonItems._set([{ id: 'canon-lime', name: 'Lime' }]);

    render(ProductFormEditPage);

    const labelInput = await screen.findByTestId('product-form-label-input');
    await fireEvent.input(labelInput, { target: { value: 'Lime juice' } });
    await fireEvent.blur(labelInput);
    expect(vi.mocked(addProductForm)).not.toHaveBeenCalled();

    await fireEvent.input(screen.getByTestId('product-form-matchers-input'), {
      target: { value: 'lime juice' },
    });
    await fireEvent.input(screen.getByTestId('product-form-amount-input'), {
      target: { value: '30' },
    });
    await fireEvent.click(screen.getByTestId('product-form-save-button'));

    await waitFor(() => {
      expect(vi.mocked(addProductForm)).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Lime juice', matchers: ['lime juice'] }),
      );
    });
  });

  it('seeds the parent from ?parent= so "Add form" on a canon item lands pre-filled', async () => {
    mockMembers._set([ADMIN]);
    mockCanonItems._set([{ id: 'canon-lime', name: 'Lime' }]);
    mockRouter.querystring = 'parent=canon-lime';

    render(ProductFormEditPage);

    await fireEvent.input(await screen.findByTestId('product-form-label-input'), {
      target: { value: 'Lime juice' },
    });
    await fireEvent.input(screen.getByTestId('product-form-matchers-input'), {
      target: { value: 'lime juice' },
    });
    await fireEvent.input(screen.getByTestId('product-form-amount-input'), {
      target: { value: '30' },
    });
    await fireEvent.click(screen.getByTestId('product-form-save-button'));

    await waitFor(() => {
      expect(vi.mocked(addProductForm)).toHaveBeenCalledWith(
        expect.objectContaining({ parentCanonId: 'canon-lime' }),
      );
    });
  });
});

describe('ProductFormEditPage — edit', () => {
  it('renders the edit form when the router passes an id param', async () => {
    renderEdit();
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

  it('has no Save or Cancel — every field autosaves', async () => {
    renderEdit();
    await screen.findByTestId('product-form-matchers-input');
    expect(screen.queryByTestId('product-form-save-button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('saves the label on blur from the title editor', async () => {
    renderEdit();

    await fireEvent.click(await screen.findByRole('button', { name: /edit label/i }));
    const labelInput = screen.getByTestId('product-form-label-input');
    await fireEvent.input(labelInput, { target: { value: 'Lime peel' } });
    await fireEvent.blur(labelInput);

    await waitFor(() => {
      expect(vi.mocked(editProductForm)).toHaveBeenCalledWith(
        LIME_ZEST,
        expect.objectContaining({ label: 'Lime peel' }),
      );
    });
  });

  it('saves the matchers on blur', async () => {
    renderEdit();

    const matchers = await screen.findByTestId('product-form-matchers-input');
    await fireEvent.input(matchers, { target: { value: 'lime zest, zest of lime' } });
    await fireEvent.blur(matchers);

    await waitFor(() => {
      expect(vi.mocked(editProductForm)).toHaveBeenCalledWith(
        LIME_ZEST,
        expect.objectContaining({ matchers: ['lime zest', 'zest of lime'] }),
      );
    });
  });

  it('reverts the matchers on Escape and writes nothing', async () => {
    renderEdit();

    const matchers = await screen.findByTestId('product-form-matchers-input');
    await fireEvent.input(matchers, { target: { value: 'nonsense' } });
    await fireEvent.keyDown(matchers, { key: 'Escape' });

    expect(matchers).toHaveValue('lime zest');
    await fireEvent.blur(matchers);
    expect(vi.mocked(editProductForm)).not.toHaveBeenCalled();
  });
});

describe('ProductFormEditPage — pending review', () => {
  const PENDING: ProductForm = { ...LIME_ZEST, needs_approval: true };

  it('shows the review strip above ONE field stack, and Confirm below it', async () => {
    renderEdit(PENDING);

    await screen.findByTestId('product-form-review-banner');
    expect(screen.getAllByTestId('product-form-matchers-input')).toHaveLength(1);
    expect(screen.getAllByTestId('product-form-amount-input')).toHaveLength(1);
    expect(screen.getByTestId('product-form-confirm-button')).toBeTruthy();
  });

  it('confirms in place — the fields stay put and the page does not navigate', async () => {
    renderEdit(PENDING);

    await fireEvent.click(await screen.findByTestId('product-form-confirm-button'));

    await waitFor(() => {
      expect(vi.mocked(confirmProductForm)).toHaveBeenCalledWith(
        PENDING,
        expect.objectContaining({ label: 'Lime zest', matchers: ['lime zest'] }),
      );
    });
    expect(vi.mocked(push)).not.toHaveBeenCalled();

    // The live subscription echoes the confirmed form back: the strip and the
    // button go, the fields do not move.
    mockProductForms._set([{ ...PENDING, needs_approval: false }]);
    await waitFor(() => {
      expect(screen.queryByTestId('product-form-review-banner')).toBeNull();
    });
    expect(screen.getAllByTestId('product-form-matchers-input')).toHaveLength(1);
  });
});

describe('ProductFormEditPage — delete', () => {
  it('offers an undo toast instead of a confirm dialog, and returns to the list', async () => {
    renderEdit();

    await fireEvent.click(await screen.findByTestId('product-form-delete-button'));

    expect(screen.queryByTestId('product-form-delete-dialog')).toBeNull();
    expect(vi.mocked(addToast)).toHaveBeenCalledWith(
      '"Lime zest" deleted',
      'default',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
    );
    expect(vi.mocked(push)).toHaveBeenCalledWith('/admin/product-forms');
  });

  it('commits the delete once the toast lapses, even though the form leaves the store first', async () => {
    // The live subscription drops the deleted doc as the delete resolves, so
    // `existing` derives to null mid-flight. The id and label are therefore read
    // before the deferral, not after it.
    renderEdit();
    vi.mocked(deleteProductForm).mockImplementation(async () => {
      mockProductForms._set([]);
      return { kind: 'ok', value: undefined };
    });

    await fireEvent.click(await screen.findByTestId('product-form-delete-button'));

    await waitFor(() => {
      expect(vi.mocked(deleteProductForm)).toHaveBeenCalledWith('form-1');
    });
    expect(vi.mocked(push)).toHaveBeenCalledWith('/admin/product-forms');
  });
});
