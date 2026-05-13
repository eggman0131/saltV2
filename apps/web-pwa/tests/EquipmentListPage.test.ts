import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { EquipmentManifest } from '@salt/domain';

const { mockEquipment, mockIsLoading } = vi.hoisted(() => {
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
    mockEquipment: makeStore<EquipmentManifest | null>(null),
    mockIsLoading: makeStore<boolean>(false),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/equipmentService.js', () => ({
  equipment: mockEquipment,
  isLoadingEquipment: mockIsLoading,
  removeEquipmentItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import EquipmentListPage from '../src/routes/equipment/EquipmentListPage.svelte';
import { push } from 'svelte-spa-router';
import { removeEquipmentItem } from '../src/lib/equipmentService.js';

function item(
  id: string,
  name: string,
  accessoryCount = 0,
  ruleCount = 0,
): EquipmentManifest['items'][number] {
  return {
    id,
    schemaVersion: 1,
    name,
    accessories: Array.from({ length: accessoryCount }, (_, i) => ({
      id: `${id}-acc-${i}`,
      name: `Acc ${i}`,
      owned: false,
      included: false,
    })),
    rules: Array.from({ length: ruleCount }, (_, i) => `rule ${i}`),
    updatedAt: '2026-05-13T00:00:00.000Z',
  };
}

function manifest(items: EquipmentManifest['items']): EquipmentManifest {
  return { schemaVersion: 1, updatedAt: '2026-05-13T00:00:00.000Z', items };
}

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockEquipment._set(null);
  mockIsLoading._set(false);
});

describe('EquipmentListPage', () => {
  it('renders empty state when manifest has no items', () => {
    mockEquipment._set(manifest([]));
    render(EquipmentListPage);
    // ListPage renders the empty-state via the isEmpty prop; just confirm the list is absent.
    expect(screen.queryByTestId('equipment-list')).not.toBeInTheDocument();
  });

  it('renders one row per item, sorted alphabetically by name', () => {
    mockEquipment._set(
      manifest([item('z', 'Zester'), item('a', 'Apple corer'), item('m', 'Mixer')]),
    );
    render(EquipmentListPage);
    const rows = screen.getAllByTestId('equipment-list-item');
    expect(rows.map((r) => r.textContent?.trim().split(/\s+/)[0])).toEqual([
      'Apple',
      'Mixer',
      'Zester',
    ]);
  });

  it('renders singular "1 accessory" when an item has exactly one accessory', () => {
    mockEquipment._set(manifest([item('a', 'Mixer', 1, 0)]));
    render(EquipmentListPage);
    expect(screen.getByText(/1 accessory\b/)).toBeInTheDocument();
    expect(screen.queryByText(/accessoryies/)).not.toBeInTheDocument();
  });

  it('renders plural "2 accessories" when an item has multiple accessories (no "accessoryies" typo)', () => {
    mockEquipment._set(manifest([item('a', 'Mixer', 2, 0)]));
    render(EquipmentListPage);
    expect(screen.getByText(/2 accessories\b/)).toBeInTheDocument();
    expect(screen.queryByText(/accessoryies/)).not.toBeInTheDocument();
  });

  it('navigates to the detail page when a row is clicked', async () => {
    mockEquipment._set(manifest([item('mixer-id', 'Mixer')]));
    render(EquipmentListPage);
    await userEvent.click(screen.getByTestId('equipment-list-item'));
    expect(vi.mocked(push)).toHaveBeenCalledWith('/equipment/mixer-id');
  });

  it('confirm-and-delete flow calls removeEquipmentItem', async () => {
    mockEquipment._set(manifest([item('to-delete', 'Old Blender')]));
    render(EquipmentListPage);
    await userEvent.click(screen.getByRole('button', { name: /delete old blender/i }));
    await waitFor(() => screen.getByTestId('equipment-delete-dialog'));
    await userEvent.click(screen.getByTestId('equipment-delete-confirm'));
    await waitFor(() => {
      expect(vi.mocked(removeEquipmentItem)).toHaveBeenCalledWith('to-delete');
    });
  });
});
