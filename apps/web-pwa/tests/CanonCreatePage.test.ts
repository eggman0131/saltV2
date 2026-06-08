import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { CanonItem } from '@salt/domain';

// ─── Mock stores (hoisted so vi.mock factories can reference them) ─────────────

const { mockCanonItems, mockAisles, mockMembers, mockIsLoading, mockAuth } = vi.hoisted(() => {
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
    mockCanonItems: makeStore<CanonItem[]>([]),
    mockAisles: makeStore<{ id: string; name: string; position: number }[]>([]),
    // AdminGuard (canon now lives behind /admin, #157) reads these.
    mockMembers: makeStore<{ email: string; admin: boolean }[]>([]),
    mockIsLoading: makeStore<boolean>(false),
    mockAuth: { user: { email: 'admin@e.org' } as { email: string } | null },
  };
});

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));
vi.mock('../src/lib/membersService.js', () => ({
  members: mockMembers,
  isLoadingMembers: mockIsLoading,
}));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  addCanonItem: vi.fn(),
}));
vi.mock('../src/lib/aisleService.js', () => ({
  aisles: mockAisles,
  initAisles: vi.fn().mockResolvedValue(undefined),
}));

import CanonCreatePage from '../src/routes/canon/CanonCreatePage.svelte';
import { push } from 'svelte-spa-router';
import { addToast } from '../src/lib/toastStore.js';
import { addCanonItem } from '../src/lib/canonService.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function canonItem(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    schemaVersion: 2,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    updatedAt: '',
    ...overrides,
  };
}

function okResult(item: CanonItem, decision: 'created' | 'matched' | 'ai_arbitrated') {
  return { kind: 'ok' as const, value: { item, decision } };
}

afterEach(() => {
  cleanup();
  // bits-ui Dialog sets body.style.pointerEvents="none" via afterTick and resets it via
  // requestAnimationFrame. jsdom never fires rAF automatically, so reset it here to avoid
  // cross-test pointer-event contamination.
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCanonItems._set([]);
  mockAisles._set([]);
  // Pass AdminGuard: signed-in user is an admin member (#157).
  mockAuth.user = { email: 'admin@e.org' };
  mockIsLoading._set(false);
  mockMembers._set([{ email: 'admin@e.org', admin: true }]);
});

// ─── Helper: open combobox and type ───────────────────────────────────────────

async function openAndType(text: string) {
  const input = screen.getByRole('combobox');
  await userEvent.click(input);
  await userEvent.type(input, text);
  return input;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CanonCreatePage', () => {
  describe('combobox filtering', () => {
    it('shows item when input matches name case-insensitively', async () => {
      mockCanonItems._set([canonItem({ id: 'oo1', name: 'Olive Oil' })]);
      render(CanonCreatePage);
      await openAndType('OLIVE');
      expect(screen.getByRole('option', { name: 'Olive Oil' })).toBeInTheDocument();
    });

    it('shows item when input matches a synonym', async () => {
      mockCanonItems._set([canonItem({ id: 'oo1', name: 'Olive Oil', synonyms: ['EVOO'] })]);
      render(CanonCreatePage);
      await openAndType('evoo');
      expect(screen.getByRole('option', { name: 'Olive Oil' })).toBeInTheDocument();
    });

    it('hides item when input matches neither name nor synonyms', async () => {
      mockCanonItems._set([canonItem({ id: 'oo1', name: 'Olive Oil', synonyms: ['EVOO'] })]);
      render(CanonCreatePage);
      await openAndType('garlic');
      expect(screen.queryByRole('option', { name: 'Olive Oil' })).not.toBeInTheDocument();
    });

    it('shows all items when input is empty', async () => {
      mockCanonItems._set([
        canonItem({ id: 'a1', name: 'Apple' }),
        canonItem({ id: 'b1', name: 'Banana' }),
      ]);
      render(CanonCreatePage);
      const input = screen.getByRole('combobox');
      await userEvent.click(input);
      expect(screen.getAllByRole('option')).toHaveLength(2);
    });
  });

  describe('pending state', () => {
    it('shows pending indicator while addCanonItem is resolving', async () => {
      let resolveFn: (v: ReturnType<typeof okResult>) => void;
      vi.mocked(addCanonItem).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFn = resolve;
        }) as ReturnType<typeof addCanonItem>,
      );
      render(CanonCreatePage);
      await openAndType('Garlic');
      await userEvent.click(screen.getByRole('option', { name: /Create "Garlic"/ }));

      await waitFor(() => {
        expect(screen.getByTestId('canon-create-pending')).toBeInTheDocument();
      });

      resolveFn!(okResult(canonItem({ id: 'g1', name: 'Garlic' }), 'created'));

      await waitFor(() => {
        expect(screen.queryByTestId('canon-create-pending')).not.toBeInTheDocument();
      });
    });
  });

  describe('decision branching — created', () => {
    it('shows a toast and navigates to the new item when decision is created', async () => {
      const newItem = canonItem({ id: 'g1', name: 'Garlic' });
      vi.mocked(addCanonItem).mockResolvedValueOnce(okResult(newItem, 'created'));
      render(CanonCreatePage);
      await openAndType('Garlic');
      await userEvent.click(screen.getByRole('option', { name: /Create "Garlic"/ }));

      await waitFor(() => {
        expect(vi.mocked(addToast)).toHaveBeenCalledWith(
          expect.stringContaining('Garlic'),
          'success',
        );
        expect(vi.mocked(push)).toHaveBeenCalledWith('/admin/canon/g1');
      });
    });
  });

  describe('decision branching — matched', () => {
    it('navigates straight to the matched item without a confirm dialog', async () => {
      const existing = canonItem({ id: 'oo1', name: 'Olive Oil' });
      vi.mocked(addCanonItem).mockResolvedValueOnce(okResult(existing, 'matched'));
      render(CanonCreatePage);
      await openAndType('olive oil');
      await userEvent.click(screen.getByRole('option', { name: /Create "olive oil"/ }));

      await waitFor(() => expect(vi.mocked(push)).toHaveBeenCalledWith('/admin/canon/oo1'));
    });
  });

  describe('decision branching — ai_arbitrated', () => {
    it('navigates straight to the AI-resolved item without a confirm dialog', async () => {
      const existing = canonItem({ id: 'oo1', name: 'Olive Oil' });
      vi.mocked(addCanonItem).mockResolvedValueOnce(okResult(existing, 'ai_arbitrated'));
      render(CanonCreatePage);
      await openAndType('liquid gold');
      await userEvent.click(screen.getByRole('option', { name: /Create "liquid gold"/ }));

      await waitFor(() => expect(vi.mocked(push)).toHaveBeenCalledWith('/admin/canon/oo1'));
    });
  });

  describe('select existing from combobox', () => {
    it('navigates to the existing item without creating when selected from dropdown', async () => {
      mockCanonItems._set([canonItem({ id: 'oo1', name: 'Olive Oil' })]);
      render(CanonCreatePage);
      await openAndType('Olive');
      await userEvent.click(screen.getByRole('option', { name: 'Olive Oil' }));

      await waitFor(() => {
        expect(vi.mocked(push)).toHaveBeenCalledWith('/admin/canon/oo1');
      });
      expect(vi.mocked(addCanonItem)).not.toHaveBeenCalled();
    });
  });

  describe('error state', () => {
    it('shows an error message when addCanonItem returns an error', async () => {
      vi.mocked(addCanonItem).mockResolvedValueOnce({
        kind: 'err',
        error: { kind: 'ValidationError', field: 'name', reason: 'empty' },
      });
      render(CanonCreatePage);
      await openAndType('Garlic');
      await userEvent.click(screen.getByRole('option', { name: /Create "Garlic"/ }));

      await waitFor(() => {
        expect(screen.getByText(/Failed to save/i)).toBeInTheDocument();
      });
    });
  });
});
