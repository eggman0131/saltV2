import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { CanonItem } from '@salt/domain';

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
    mockAisles: makeStore<{ id: string; name: string; order: number }[]>([]),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/aisleService.js', () => ({
  aisles: mockAisles,
  initAisles: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  updateCanonItemName: vi.fn(),
  updateCanonItemAisle: vi.fn(),
  updateCanonItemSynonyms: vi.fn(),
  updateCanonItemShoppingBehavior: vi.fn(),
  updateCanonItemThreshold: vi.fn(),
  approveCanonItemWithOverrides: vi.fn(),
  deleteCanonItem: vi.fn(),
  splitMostRecentSynonym: vi.fn(),
  regenerateCanonIcon: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  hideCanonIcon: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  unhideCanonIcon: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import CanonDetailPage from '../src/routes/canon/CanonDetailPage.svelte';
import { regenerateCanonIcon, hideCanonIcon, unhideCanonIcon } from '../src/lib/canonService.js';

const ITEM_ID = 'c1';

function canonItem(overrides: Partial<CanonItem> = {}): CanonItem {
  return {
    id: ITEM_ID,
    schemaVersion: 5,
    name: 'milk',
    synonyms: [],
    aisleId: null,
    thumbnail: 'https://example.com/milk.webp',
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  // bits-ui Dialog toggles body styles via rAF, which jsdom never fires.
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAisles._set([]);
  mockCanonItems._set([]);
});

describe('CanonDetailPage — icon escape hatch', () => {
  it('renders the icon section with the current icon', () => {
    mockCanonItems._set([canonItem()]);
    const { getByTestId } = render(CanonDetailPage, { props: { params: { id: ITEM_ID } } });
    expect(getByTestId('canon-detail-icon-section')).toBeInTheDocument();
    expect(getByTestId('canon-icon-img')).toBeInTheDocument();
  });

  it('opens a dialog and regenerates with no hint on confirm', async () => {
    mockCanonItems._set([canonItem()]);
    const { getByTestId, findByTestId } = render(CanonDetailPage, {
      props: { params: { id: ITEM_ID } },
    });
    await fireEvent.click(getByTestId('canon-detail-icon-regenerate'));
    await fireEvent.click(await findByTestId('canon-detail-regenerate-confirm'));
    await waitFor(() => expect(regenerateCanonIcon).toHaveBeenCalledWith(ITEM_ID, undefined));
  });

  it('passes the typed hint to regenerate', async () => {
    mockCanonItems._set([canonItem()]);
    const { getByTestId, findByTestId } = render(CanonDetailPage, {
      props: { params: { id: ITEM_ID } },
    });
    await fireEvent.click(getByTestId('canon-detail-icon-regenerate'));
    const hintInput = await findByTestId('canon-detail-regenerate-hint');
    await fireEvent.input(hintInput, { target: { value: 'show it as a tin' } });
    await fireEvent.click(getByTestId('canon-detail-regenerate-confirm'));
    await waitFor(() =>
      expect(regenerateCanonIcon).toHaveBeenCalledWith(ITEM_ID, 'show it as a tin'),
    );
  });

  it('shows Hide for a visible icon and hides on click', async () => {
    mockCanonItems._set([canonItem({ thumbnail: 'https://example.com/milk.webp' })]);
    const { getByTestId, queryByTestId } = render(CanonDetailPage, {
      props: { params: { id: ITEM_ID } },
    });
    expect(queryByTestId('canon-detail-icon-unhide')).toBeNull();
    await fireEvent.click(getByTestId('canon-detail-icon-hide'));
    await waitFor(() => expect(hideCanonIcon).toHaveBeenCalledTimes(1));
  });

  it('shows Unhide for a hidden icon and unhides on click', async () => {
    mockCanonItems._set([canonItem({ thumbnail: 'hidden' })]);
    const { getByTestId, queryByTestId } = render(CanonDetailPage, {
      props: { params: { id: ITEM_ID } },
    });
    expect(queryByTestId('canon-detail-icon-hide')).toBeNull();
    // Hidden icon shows the bare tile (no img).
    expect(queryByTestId('canon-icon-img')).toBeNull();
    await fireEvent.click(getByTestId('canon-detail-icon-unhide'));
    await waitFor(() => expect(unhideCanonIcon).toHaveBeenCalledWith(ITEM_ID));
  });
});
