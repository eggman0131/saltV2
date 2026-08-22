import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import type { EquipmentManifest } from '@salt/domain';
import type { EquipmentIconDoc } from '@salt/domain/schemas';

// The description panel's revision loop (issue #885). Revise and Start over both
// rewrite the words in the box and PERSIST NOTHING — Draw is still the only thing
// that writes a description to the item, and the only thing that spends money.

const { mockEquipment, mockEquipmentIcons } = vi.hoisted(() => {
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
        subs.forEach((f) => f(v));
      },
    };
  }
  return {
    mockEquipment: makeStore<EquipmentManifest | null>(null),
    mockEquipmentIcons: makeStore<Map<string, EquipmentIconDoc>>(new Map()),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/nav.js', () => ({ goBack: vi.fn() }));
vi.mock('../src/lib/equipmentService.js', () => ({
  equipment: mockEquipment,
  equipmentIcons: mockEquipmentIcons,
  equipmentIconFor: (icons: Map<string, EquipmentIconDoc>, id: string) => icons.get(id) ?? null,
  equipmentThumbnailFor: () => null,
  equipmentIconVersionFor: () => undefined,
  drawEquipmentIcon: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  hideEquipmentIcon: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  reviseEquipmentBrief: vi.fn(),
  restartEquipmentBrief: vi.fn(),
  renameEquipmentItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  removeEquipmentItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  addEquipmentAccessory: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  removeEquipmentAccessory: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  toggleEquipmentAccessoryOwned: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  addEquipmentRule: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  removeEquipmentRule: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  editEquipmentRule: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import EquipmentEditPage from '../src/routes/equipment/EquipmentEditPage.svelte';
import {
  drawEquipmentIcon,
  reviseEquipmentBrief,
  restartEquipmentBrief,
} from '../src/lib/equipmentService.js';

const ITEM_ID = 'mixer-1';
const NAME = 'Kenwood Chef KVC3100S';
const STORED_BRIEF = 'A tilt-head stand mixer with a cream enamel body and a chrome bowl.';

function seed(brief = STORED_BRIEF): void {
  mockEquipment._set({
    schemaVersion: 1,
    updatedAt: '2026-08-22T00:00:00.000Z',
    items: [
      {
        id: ITEM_ID,
        schemaVersion: 1,
        name: NAME,
        accessories: [],
        rules: [],
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    ],
  });
  mockEquipmentIcons._set(
    new Map<string, EquipmentIconDoc>([
      [
        ITEM_ID,
        {
          subjectBrief: brief,
          briefSourceName: NAME,
          thumbnail: null,
          updatedAt: '2026-08-22T00:00:00.000Z',
        },
      ],
    ]),
  );
}

function renderPage() {
  return render(EquipmentEditPage, { props: { params: { id: ITEM_ID } } });
}

function brief(): HTMLTextAreaElement {
  return screen.getByTestId('equipment-icon-brief') as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('EquipmentEditPage — Revise', () => {
  it('rewrites the description from a correction, and draws nothing', async () => {
    vi.mocked(reviseEquipmentBrief).mockResolvedValue({
      kind: 'ok',
      value: 'A matte black tilt-head stand mixer with a chrome bowl.',
    });
    renderPage();

    await fireEvent.input(screen.getByTestId('equipment-icon-steer'), {
      target: { value: "it's matte black, not cream" },
    });
    await fireEvent.click(screen.getByTestId('equipment-icon-revise-btn'));

    await waitFor(() => {
      expect(brief().value).toBe('A matte black tilt-head stand mixer with a chrome bowl.');
    });
    expect(vi.mocked(reviseEquipmentBrief)).toHaveBeenCalledWith(
      NAME,
      STORED_BRIEF,
      "it's matte black, not cream",
    );
    // Nothing is drawn and nothing is saved: Draw is still the only writer.
    expect(vi.mocked(drawEquipmentIcon)).not.toHaveBeenCalled();
  });

  it('spends the correction — the steer box empties so a second Revise is a new one', async () => {
    vi.mocked(reviseEquipmentBrief).mockResolvedValue({
      kind: 'ok',
      value: 'A matte black mixer.',
    });
    renderPage();

    const steer = screen.getByTestId('equipment-icon-steer') as HTMLInputElement;
    await fireEvent.input(steer, { target: { value: "it's matte black" } });
    await fireEvent.click(screen.getByTestId('equipment-icon-revise-btn'));

    await waitFor(() => expect(steer.value).toBe(''));
  });

  it('revises what is ON SCREEN, including a hand edit, not the stored words', async () => {
    vi.mocked(reviseEquipmentBrief).mockResolvedValue({ kind: 'ok', value: 'Revised.' });
    renderPage();

    await fireEvent.input(brief(), { target: { value: 'My own hand-typed description.' } });
    await fireEvent.input(screen.getByTestId('equipment-icon-steer'), {
      target: { value: 'add the tank' },
    });
    await fireEvent.click(screen.getByTestId('equipment-icon-revise-btn'));

    await waitFor(() => {
      expect(vi.mocked(reviseEquipmentBrief)).toHaveBeenCalledWith(
        NAME,
        'My own hand-typed description.',
        'add the tank',
      );
    });
  });

  it('a failure leaves the box EXACTLY as it was and says so', async () => {
    vi.mocked(reviseEquipmentBrief).mockResolvedValue({
      kind: 'failure',
      error: { kind: 'NetworkError', reason: 'transient' },
    });
    renderPage();

    // Several edits deep — precisely the text a failed revision must not cost.
    await fireEvent.input(brief(), { target: { value: 'Six edits deep.' } });
    await fireEvent.input(screen.getByTestId('equipment-icon-steer'), {
      target: { value: 'make it black' },
    });
    await fireEvent.click(screen.getByTestId('equipment-icon-revise-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('equipment-icon-brief-error')).toBeTruthy();
    });
    expect(brief().value).toBe('Six edits deep.');
    // And the correction survives too, so pressing again costs no retyping.
    expect((screen.getByTestId('equipment-icon-steer') as HTMLInputElement).value).toBe(
      'make it black',
    );
  });

  it('is not offered without a correction to apply', () => {
    renderPage();
    expect((screen.getByTestId('equipment-icon-revise-btn') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('EquipmentEditPage — Start over', () => {
  it('writes a fresh description from the name, discarding accumulated edits', async () => {
    vi.mocked(restartEquipmentBrief).mockResolvedValue({
      kind: 'ok',
      value: 'A tilt-head stand mixer, as first described.',
    });
    renderPage();

    await fireEvent.input(brief(), { target: { value: 'Edited into a corner.' } });
    await fireEvent.click(screen.getByTestId('equipment-icon-start-over-btn'));

    await waitFor(() => {
      expect(brief().value).toBe('A tilt-head stand mixer, as first described.');
    });
    // The name alone — no brief, no steer — which is what the trigger sends too.
    expect(vi.mocked(restartEquipmentBrief)).toHaveBeenCalledWith(NAME);
    expect(vi.mocked(drawEquipmentIcon)).not.toHaveBeenCalled();
  });

  it('a failure leaves the box exactly as it was', async () => {
    vi.mocked(restartEquipmentBrief).mockResolvedValue({
      kind: 'failure',
      error: { kind: 'NetworkError', reason: 'transient' },
    });
    renderPage();

    await fireEvent.input(brief(), { target: { value: 'Edited into a corner.' } });
    await fireEvent.click(screen.getByTestId('equipment-icon-start-over-btn'));

    await waitFor(() => expect(screen.getByTestId('equipment-icon-brief-error')).toBeTruthy());
    expect(brief().value).toBe('Edited into a corner.');
  });
});

describe('EquipmentEditPage — Draw still owns the words', () => {
  it('draws exactly what is in the box after a revision', async () => {
    vi.mocked(reviseEquipmentBrief).mockResolvedValue({
      kind: 'ok',
      value: 'A matte black tilt-head stand mixer.',
    });
    renderPage();

    await fireEvent.input(screen.getByTestId('equipment-icon-steer'), {
      target: { value: "it's matte black" },
    });
    await fireEvent.click(screen.getByTestId('equipment-icon-revise-btn'));
    await waitFor(() => expect(brief().value).toBe('A matte black tilt-head stand mixer.'));

    await fireEvent.click(screen.getByTestId('equipment-icon-draw-btn'));

    await waitFor(() => {
      expect(vi.mocked(drawEquipmentIcon)).toHaveBeenCalledWith(
        ITEM_ID,
        'A matte black tilt-head stand mixer.',
      );
    });
  });
});
