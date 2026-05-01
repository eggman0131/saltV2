import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { CanonItem } from '@salt/domain';

// ─── Mock stores (hoisted so vi.mock factories can reference them) ─────────────

const { mockCanonItems, mockAisles } = vi.hoisted(() => {
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
  };
});

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  updateCanonItemName: vi.fn(),
  updateCanonItemAisle: vi.fn(),
  updateCanonItemSynonyms: vi.fn(),
  deleteCanonItem: vi.fn(),
}));
vi.mock('../src/lib/aisleService.js', () => ({
  aisles: mockAisles,
  initAisles: vi.fn().mockResolvedValue(undefined),
}));

import CanonDetailPage from '../src/routes/canon/CanonDetailPage.svelte';
import { push } from 'svelte-spa-router';
import { addToast } from '../src/lib/toastStore.js';
import {
  updateCanonItemName,
  updateCanonItemAisle,
  updateCanonItemSynonyms,
  deleteCanonItem,
} from '../src/lib/canonService.js';

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
    revision: 0,
    deletedAt: null,
    ...overrides,
  };
}

const ITEM_ID = 'oo1';

afterEach(() => {
  cleanup();
  // bits-ui Dialog sets body.style.pointerEvents="none" via afterTick and resets it via
  // requestAnimationFrame. jsdom never fires rAF automatically, so reset it here.
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCanonItems._set([]);
  mockAisles._set([]);
});

// Helper: render with a known item in the store
function setupWithItem(item = canonItem({ id: ITEM_ID, name: 'Olive Oil' })) {
  mockCanonItems._set([item]);
  return render(CanonDetailPage, { params: { id: ITEM_ID } });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CanonDetailPage', () => {
  describe('not-found state', () => {
    it('renders a not-found message when item is absent from the store', () => {
      mockCanonItems._set([]);
      render(CanonDetailPage, { params: { id: 'missing' } });
      expect(screen.getByText(/Item not found/i)).toBeInTheDocument();
    });
  });

  describe('renders item details', () => {
    it('pre-fills the name field with the item name', async () => {
      setupWithItem();
      const nameInput = screen.getByTestId('canon-detail-name-input');
      expect(nameInput).toHaveValue('Olive Oil');
    });

    it('pre-fills the synonyms field with comma-joined synonyms', async () => {
      setupWithItem(
        canonItem({ id: ITEM_ID, name: 'Olive Oil', synonyms: ['EVOO', 'liquid gold'] }),
      );
      const synonymsInput = screen.getByTestId('canon-detail-synonyms-input');
      expect(synonymsInput).toHaveValue('EVOO, liquid gold');
    });

    it('shows empty synonyms field when item has no synonyms', async () => {
      setupWithItem();
      const synonymsInput = screen.getByTestId('canon-detail-synonyms-input');
      expect(synonymsInput).toHaveValue('');
    });
  });

  describe('name editing', () => {
    it('calls updateCanonItemName with the new trimmed value on save', async () => {
      const item = canonItem({ id: ITEM_ID, name: 'Olive Oil' });
      vi.mocked(updateCanonItemName).mockResolvedValueOnce({
        kind: 'ok',
        value: { ...item, name: 'Extra Virgin Olive Oil' },
      });
      setupWithItem(item);

      const nameInput = screen.getByTestId('canon-detail-name-input');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, '  Extra Virgin Olive Oil  ');

      await userEvent.click(screen.getByTestId('canon-detail-name-save'));

      await waitFor(() => {
        expect(vi.mocked(updateCanonItemName)).toHaveBeenCalledWith(item, 'Extra Virgin Olive Oil');
      });
    });

    it('shows a name error when updateCanonItemName returns an error', async () => {
      const item = canonItem({ id: ITEM_ID, name: 'Olive Oil' });
      vi.mocked(updateCanonItemName).mockResolvedValueOnce({
        kind: 'err',
        error: { kind: 'ValidationError', field: 'name', reason: 'empty' },
      });
      setupWithItem(item);

      const nameInput = screen.getByTestId('canon-detail-name-input');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'Changed');
      await userEvent.click(screen.getByTestId('canon-detail-name-save'));

      await waitFor(() => {
        expect(screen.getByText(/Invalid name/i)).toBeInTheDocument();
      });
    });
  });

  describe('synonyms editing', () => {
    it('calls updateCanonItemSynonyms with the parsed synonyms array on save', async () => {
      const item = canonItem({ id: ITEM_ID, name: 'Olive Oil' });
      vi.mocked(updateCanonItemSynonyms).mockResolvedValueOnce({
        kind: 'ok',
        value: { ...item, synonyms: ['EVOO', 'liquid gold'] },
      });
      setupWithItem(item);

      const synonymsInput = screen.getByTestId('canon-detail-synonyms-input');
      await userEvent.clear(synonymsInput);
      await userEvent.type(synonymsInput, 'EVOO, liquid gold');
      await userEvent.click(screen.getByTestId('canon-detail-synonyms-save'));

      await waitFor(() => {
        expect(vi.mocked(updateCanonItemSynonyms)).toHaveBeenCalledWith(item, [
          'EVOO',
          'liquid gold',
        ]);
      });
    });

    it('trims whitespace from each synonym before calling service', async () => {
      const item = canonItem({ id: ITEM_ID, name: 'Olive Oil' });
      vi.mocked(updateCanonItemSynonyms).mockResolvedValueOnce({ kind: 'ok', value: item });
      setupWithItem(item);

      const synonymsInput = screen.getByTestId('canon-detail-synonyms-input');
      await userEvent.clear(synonymsInput);
      await userEvent.type(synonymsInput, ' EVOO ,  liquid gold ');
      await userEvent.click(screen.getByTestId('canon-detail-synonyms-save'));

      await waitFor(() => {
        expect(vi.mocked(updateCanonItemSynonyms)).toHaveBeenCalledWith(item, [
          'EVOO',
          'liquid gold',
        ]);
      });
    });
  });

  describe('aisle editing', () => {
    it('calls updateCanonItemAisle when a different aisle is selected', async () => {
      const item = canonItem({ id: ITEM_ID, name: 'Olive Oil', aisleId: null });
      vi.mocked(updateCanonItemAisle).mockResolvedValueOnce({ kind: 'ok', value: item });
      mockAisles._set([{ id: 'oils', name: 'Oils & Vinegars', position: 0 }]);
      setupWithItem(item);

      // Open the aisle select (SelectTrigger renders as a button)
      const trigger = screen.getByRole('button', { name: /no aisle/i });
      await userEvent.click(trigger);
      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'Oils & Vinegars' })).toBeInTheDocument(),
      );
      await userEvent.click(screen.getByRole('option', { name: 'Oils & Vinegars' }));

      await waitFor(() => {
        expect(vi.mocked(updateCanonItemAisle)).toHaveBeenCalledWith(item, 'oils');
      });
    });
  });

  describe('delete', () => {
    it('opens the delete dialog when the delete button is clicked', async () => {
      setupWithItem();
      await userEvent.click(screen.getByTestId('canon-detail-delete-button'));
      await waitFor(() => {
        expect(screen.getByTestId('canon-detail-delete-dialog')).toBeInTheDocument();
      });
    });

    it('calls deleteCanonItem with the item id when confirm is clicked', async () => {
      vi.mocked(deleteCanonItem).mockResolvedValueOnce({ kind: 'ok', value: undefined });
      setupWithItem();
      await userEvent.click(screen.getByTestId('canon-detail-delete-button'));
      await waitFor(() =>
        expect(screen.getByTestId('canon-detail-delete-dialog')).toBeInTheDocument(),
      );

      await userEvent.click(screen.getByTestId('canon-detail-delete-confirm'));

      await waitFor(() => {
        expect(vi.mocked(deleteCanonItem)).toHaveBeenCalledWith(ITEM_ID);
      });
    });

    it('shows a toast and navigates to /canon after successful delete', async () => {
      vi.mocked(deleteCanonItem).mockResolvedValueOnce({ kind: 'ok', value: undefined });
      setupWithItem();
      await userEvent.click(screen.getByTestId('canon-detail-delete-button'));
      await waitFor(() =>
        expect(screen.getByTestId('canon-detail-delete-dialog')).toBeInTheDocument(),
      );

      await userEvent.click(screen.getByTestId('canon-detail-delete-confirm'));

      await waitFor(() => {
        expect(vi.mocked(addToast)).toHaveBeenCalledWith(
          expect.stringContaining('Olive Oil'),
          'success',
        );
        expect(vi.mocked(push)).toHaveBeenCalledWith('/canon');
      });
    });
  });
});
