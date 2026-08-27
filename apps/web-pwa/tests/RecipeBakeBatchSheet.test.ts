import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';
import type { Formula } from '@salt/domain/schemas';

// The scale sheet (issue #812, phase 1 of epic #778) — "Bake a batch".
//
// This is the ONE place a scaled quantity appears before a batch exists
// (docs/formulas-schedules-batches.md: the recipe never shows scaled numbers), so
// the bar it has to clear is high:
//
//   • the preview is #778's worked example to the gram — twelve 120 g rolls off the
//     overnight tin gives 841 g flour, 589 g water, 17 g salt, 12 g yeast, 25 g
//     olive oil, 1 483 g in the bowl including the 3% handling allowance, and about
//     108 g each once baked;
//   • it is the SAME arithmetic the freeze will do, so what is on screen is what
//     lands on the document;
//   • it writes nothing — not to the recipe, not to the formula. Closing it leaves
//     the weekly loaf a weekly loaf;
//   • a run that cannot be started says why, in the words the service chose, and
//     stays put instead of navigating.

const { mockStartBatch, mockProposeSchedule, mockAddToast } = vi.hoisted(() => ({
  mockStartBatch: vi.fn(),
  mockProposeSchedule: vi.fn(),
  mockAddToast: vi.fn(),
}));

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: mockAddToast }));
vi.mock('../src/lib/batchService.js', () => ({
  startBatch: mockStartBatch,
  proposeSchedule: mockProposeSchedule,
}));

import { push } from 'svelte-spa-router';
import RecipeBakeBatchSheet from '../src/routes/recipes/RecipeBakeBatchSheet.svelte';

const RECIPE_ID = 'recipe-1';

function ingredient(id: string, rawText: string) {
  return {
    id,
    rawText,
    parsed: null,
    canonId: null,
    matchState: 'matched' as const,
    isOptional: false,
    firstUsedInStepId: null,
  };
}

// The overnight white tin as Salt holds it, plus the olive oil the worked example
// carries. The recipe's OWN quantities — nothing here is ever scaled.
const RECIPE = {
  id: RECIPE_ID,
  schemaVersion: 1,
  kind: 'recipe',
  title: 'Overnight white tin',
  description: null,
  ingredients: [
    {
      id: 'grp-1',
      name: null,
      items: [
        ingredient('ing-flour', '500 g strong white flour'),
        ingredient('ing-water', '350 g water'),
        ingredient('ing-salt', '10 g salt'),
        ingredient('ing-yeast', '7 g instant yeast'),
        ingredient('ing-oil', '15 g olive oil'),
      ],
    },
  ],
  steps: [{ id: 'step-1', text: 'Mix.', timer: null, note: null }],
  metadata: {
    servings: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: null,
    tags: [],
  },
  source: null,
  notes: null,
  image: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

// Reference yield: twelve 120 g rolls, which is a preset the picker recognises, so
// the sheet opens already saying what the last person declared.
const FORMULA: Formula = {
  recipeId: RECIPE_ID,
  schemaVersion: 1,
  components: [
    { ingredientId: 'ing-flour', percent: 100, inBasis: true },
    { ingredientId: 'ing-water', percent: 70, inBasis: false },
    { ingredientId: 'ing-salt', percent: 2, inBasis: false },
    { ingredientId: 'ing-yeast', percent: 1.4, inBasis: false },
    { ingredientId: 'ing-oil', percent: 3, inBasis: false },
  ],
  referenceYield: {
    kind: 'target',
    shape: { label: '120 g roll', count: 12, unitDoughGrams: 120, bakeLossPercent: 10 },
  },
  handlingLossPercent: 3,
} as Formula;

// A fixed "now" so the seeded start time is assertable without depending on when
// the suite runs. Only Date is faked — real timers keep Testing Library honest.
const NOW = new Date('2026-08-14T07:30:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  mockStartBatch.mockResolvedValue({ kind: 'ok', value: { id: 'batch-9' } });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.innerHTML = '';
});

function renderSheet(formula: Formula = FORMULA) {
  return render(RecipeBakeBatchSheet, { props: { recipe: RECIPE, formula, open: true } });
}

function previewGrams(): string[] {
  return screen
    .queryAllByTestId('bake-batch-preview-grams')
    .map((el) => el.textContent?.trim() ?? '');
}

describe('RecipeBakeBatchSheet — what twelve rolls weigh out to', () => {
  it('opens on the formula reference yield, so the common answer is already typed', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('bake-batch-sheet')).toBeInTheDocument());
    expect(screen.getByTestId('bake-batch-count')).toHaveValue('12');
    expect(screen.getByTestId('bake-batch-shape')).toHaveTextContent('120 g roll');
  });

  it('previews #778 worked example to the gram', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('bake-batch-preview')).toBeInTheDocument());
    expect(previewGrams()).toEqual(['841 g', '589 g', '17 g', '12 g', '25 g']);
    expect(screen.getByTestId('bake-batch-preview')).toHaveTextContent('500 g strong white flour');
  });

  it('says the dough total includes the handling allowance, and what a roll bakes to', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('bake-batch-totals')).toBeInTheDocument());
    expect(screen.getByTestId('bake-batch-total-grams')).toHaveTextContent('1483 g');
    expect(screen.getByTestId('bake-batch-totals')).toHaveTextContent(
      'including 3% for what stays in it',
    );
    expect(screen.getByTestId('bake-batch-baked-each')).toHaveTextContent(
      '12 × 120 g roll — about 108 g each once baked',
    );
  });

  it('re-solves the moment the count changes', async () => {
    // Scaling is exact, instant and offline: one function, no round trip, no model.
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('bake-batch-preview')).toBeInTheDocument());

    await fireEvent.input(screen.getByTestId('bake-batch-count'), { target: { value: '6' } });

    // Half the dough, half of every component. 720 g usable → 741.6 g total.
    await waitFor(() => expect(previewGrams()[0]).toBe('420 g'));
    expect(screen.getByTestId('bake-batch-total-grams')).toHaveTextContent('742 g');
  });

  it('offers the formula’s own shape when the preset list does not hold it', async () => {
    // A formula written for a hand-typed shape must still be bakeable at a
    // DIFFERENT count. Before the picker could name that shape, asking for six
    // silently fell back to the reference yield and made twelve.
    const boule = {
      label: '1 kg sourdough boule',
      count: 2,
      unitDoughGrams: 1000,
      bakeLossPercent: 14,
    };
    renderSheet({ ...FORMULA, referenceYield: { kind: 'target', shape: boule } } as Formula);
    await waitFor(() => expect(screen.getByTestId('bake-batch-sheet')).toBeInTheDocument());

    expect(screen.getByTestId('bake-batch-shape')).toHaveTextContent(boule.label);
    expect(screen.getByTestId('bake-batch-count')).toHaveValue('2');

    await fireEvent.input(screen.getByTestId('bake-batch-count'), { target: { value: '4' } });
    await fireEvent.click(screen.getByTestId('bake-batch-confirm'));

    await waitFor(() => expect(mockStartBatch).toHaveBeenCalledTimes(1));
    expect(mockStartBatch.mock.calls[0]![0].atYield).toEqual({
      kind: 'target',
      shape: { ...boule, count: 4 },
    });
  });

  it('falls back to the formula as written when the count is not a count', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('bake-batch-preview')).toBeInTheDocument());

    await fireEvent.input(screen.getByTestId('bake-batch-count'), { target: { value: '' } });

    // No shape means the formula's own reference yield — the same twelve rolls, not
    // an invented one and not an error.
    await waitFor(() => expect(previewGrams()[0]).toBe('841 g'));
  });
});

describe('RecipeBakeBatchSheet — starting the run', () => {
  it('freezes at the yield asked for, anchored forward from the start chosen', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('bake-batch-confirm')).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId('bake-batch-confirm'));

    await waitFor(() => expect(mockStartBatch).toHaveBeenCalledTimes(1));
    const input = mockStartBatch.mock.calls[0]![0];
    expect(input.recipe).toBe(RECIPE);
    expect(input.formula).toBe(FORMULA);
    expect(input.atYield).toEqual({
      kind: 'target',
      shape: { label: '120 g roll', count: 12, unitDoughGrams: 120, bakeLossPercent: 10 },
    });
    // The sheet opens on `startAt`: you say when you are mixing and everything is
    // timed forward from it, by arithmetic, with no model anywhere near it. The
    // other half of the anchor is opt-in and is covered in the phase-2 suite.
    expect(input.anchor.kind).toBe('startAt');
    expect(mockProposeSchedule).not.toHaveBeenCalled();
    // Seeded from now, to the minute the picker offers.
    expect(Math.abs(Date.parse(input.anchor.at) - NOW.getTime())).toBeLessThan(60_000);
  });

  it('opens the run it just started', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('bake-batch-confirm')).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId('bake-batch-confirm'));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/batches/batch-9'));
    expect(mockAddToast).toHaveBeenCalledWith('Batch started.', 'success');
  });

  it('renders why a run could not be started, and stays where it is', async () => {
    // BATCH_NOT_STARTABLE carries a sentence that says what to do next, so it is
    // shown on the sheet rather than thrown at a toast that vanishes — and it is
    // deliberately never reported to PostHog.
    mockStartBatch.mockResolvedValue({
      kind: 'err',
      error: {
        kind: 'ValidationError',
        code: 'BATCH_NOT_STARTABLE',
        message:
          'This recipe has no stages yet, so there is nothing to schedule. Add its process on the formula screen first.',
      },
    });
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('bake-batch-confirm')).toBeInTheDocument());

    await fireEvent.click(screen.getByTestId('bake-batch-confirm'));

    await waitFor(() => expect(screen.getByTestId('bake-batch-error')).toBeInTheDocument());
    expect(screen.getByTestId('bake-batch-error')).toHaveTextContent(
      'Add its process on the formula screen first.',
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId('bake-batch-sheet')).toBeInTheDocument();
  });

  it('will not start a formula that does not resolve into weights', async () => {
    renderSheet({ ...FORMULA, components: [] } as Formula);
    await waitFor(() => expect(screen.getByTestId('bake-batch-unsolvable')).toBeInTheDocument());

    expect(screen.queryByTestId('bake-batch-preview')).toBeNull();
    expect(screen.getByTestId('bake-batch-confirm')).toBeDisabled();
  });
});
