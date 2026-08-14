import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import type { BatchDoc, BatchStageDoc } from '@salt/domain/schemas';

// One run's own screen (issue #812, phase 1 of epic #778).
//
// The batch under test is #778's worked example, frozen: twelve 120 g rolls off the
// overnight tin's formula — 841 g flour, 589 g water, 17 g salt, 12 g yeast, 25 g
// olive oil, 1 483 g in the bowl including the 3% handling allowance, about 108 g
// each once baked.
//
// What this page has to get right:
//
//   • it renders the batch's OWN numbers and joins nothing. The recipe and the
//     formula are not read here at all, which is what makes "editing the recipe
//     afterwards changes nothing on the batch" true by construction rather than by
//     a re-derivation that happens to agree;
//   • a stage with a RANGE shows both the clock and the range the recipe stated;
//   • a stage with NO duration reads as observational, never as an instant event —
//     `plannedEndAt` equals `plannedStartAt` there, and printing that as a span
//     would be a confident lie;
//   • not-loaded, no-such-run and a run are three different screens.
//
// Clock times are asserted through the `data-planned-*` attributes (raw ISO), so
// none of this depends on the machine's timezone.

const { mockBatch, mockInitBatchSync } = vi.hoisted(() => {
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
    mockBatch: makeStore<BatchDoc | null | undefined>(undefined),
    mockInitBatchSync: vi.fn(() => () => {}),
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/nav.js', () => ({ goBack: vi.fn() }));
vi.mock('../src/lib/batchService.js', () => ({
  batch: mockBatch,
  initBatchSync: mockInitBatchSync,
}));

import BatchDetailPage from '../src/routes/batches/BatchDetailPage.svelte';

const BATCH_ID = 'batch-1';

function stage(over: Partial<BatchStageDoc> = {}): BatchStageDoc {
  return {
    id: 'stage-1',
    label: 'Mix',
    kind: 'active',
    environment: null,
    duration: { kind: 'fixed', minutes: 15 },
    until: null,
    stepId: null,
    plannedStartAt: '2026-08-14T07:00:00.000Z',
    plannedEndAt: '2026-08-14T07:15:00.000Z',
    actualStartAt: null,
    actualEndAt: null,
    ...over,
  };
}

/** #778's worked example, as `freezeBatch` would have written it. */
function makeBatch(over: Partial<BatchDoc> = {}): BatchDoc {
  return {
    id: BATCH_ID,
    schemaVersion: 1,
    recipeId: 'recipe-1',
    recipeTitle: 'Overnight white tin',
    state: 'running',
    quantities: [
      { ingredientId: 'ing-flour', label: '500 g strong white flour', percent: 100, grams: 841 },
      { ingredientId: 'ing-water', label: '350 g water', percent: 70, grams: 589 },
      { ingredientId: 'ing-salt', label: '10 g salt', percent: 2, grams: 17 },
      { ingredientId: 'ing-yeast', label: '7 g instant yeast', percent: 1.4, grams: 12 },
      { ingredientId: 'ing-oil', label: '15 g olive oil', percent: 3, grams: 25 },
    ],
    totals: {
      basisGrams: 841,
      totalGrams: 1483,
      usableGrams: 1440,
      units: { label: '120 g roll', count: 12, unitDoughGrams: 120, bakedUnitGrams: 108 },
    },
    stages: [
      stage(),
      stage({
        id: 'stage-2',
        label: 'Bulk ferment',
        kind: 'wait',
        environment: { celsius: 20 },
        duration: { kind: 'range', minMinutes: 45, maxMinutes: 60 },
        plannedStartAt: '2026-08-14T07:15:00.000Z',
        plannedEndAt: '2026-08-14T08:15:00.000Z',
      }),
      stage({
        id: 'stage-3',
        label: 'Prove',
        kind: 'wait',
        duration: null,
        until: 'until doubled',
        plannedStartAt: '2026-08-14T08:15:00.000Z',
        plannedEndAt: '2026-08-14T08:15:00.000Z',
      }),
    ],
    rationale: null,
    createdAt: '2026-08-14T06:45:00.000Z',
    updatedAt: '2026-08-14T06:45:00.000Z',
    ...over,
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockBatch._set(undefined);
});

function renderPage() {
  return render(BatchDetailPage, { props: { params: { id: BATCH_ID } } });
}

function gramsColumn(): string[] {
  return screen.queryAllByTestId('batch-quantity-grams').map((el) => el.textContent?.trim() ?? '');
}

describe('BatchDetailPage — the three states', () => {
  it('shows nothing but a loader while the run is still resolving', () => {
    renderPage();
    expect(screen.queryByTestId('batch-detail')).toBeNull();
  });

  it('says the run is not there once it knows it is not', async () => {
    renderPage();
    mockBatch._set(null);
    await waitFor(() => expect(screen.getByText('Batch not found')).toBeInTheDocument());
  });

  it('subscribes to the one run and disposes on teardown', () => {
    const unsub = vi.fn();
    mockInitBatchSync.mockReturnValue(unsub);
    const { unmount } = renderPage();
    expect(mockInitBatchSync).toHaveBeenCalledWith(BATCH_ID);
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});

describe('BatchDetailPage — the scaled ingredient list', () => {
  it('shows the frozen grams, in the formula order', async () => {
    renderPage();
    mockBatch._set(makeBatch());

    await waitFor(() => expect(screen.getByTestId('batch-quantities')).toBeInTheDocument());
    expect(gramsColumn()).toEqual(['841 g', '589 g', '17 g', '12 g', '25 g']);
  });

  it('carries the recipe line each figure came from, frozen at the start', async () => {
    renderPage();
    mockBatch._set(makeBatch());

    await waitFor(() => expect(screen.getByTestId('batch-quantities')).toBeInTheDocument());
    expect(screen.getByTestId('batch-quantities')).toHaveTextContent('500 g strong white flour');
    // …and the percentage the baker reasons in.
    expect(screen.getByTestId('batch-quantities')).toHaveTextContent('70%');
  });

  it('shows the totals, including what the handling allowance added', async () => {
    renderPage();
    mockBatch._set(makeBatch());

    await waitFor(() => expect(screen.getByTestId('batch-totals')).toBeInTheDocument());
    expect(screen.getByTestId('batch-total-grams')).toHaveTextContent('1483 g');
    expect(screen.getByTestId('batch-usable-grams')).toHaveTextContent('1440 g');
    expect(screen.getByTestId('batch-baked-each')).toHaveTextContent('about 108 g');
  });

  it('says an ingredient that has left the recipe is unknown rather than inventing it', async () => {
    // An empty label is honest; an id is gibberish and a guess is a fact nobody
    // established.
    renderPage();
    mockBatch._set(
      makeBatch({
        quantities: [{ ingredientId: 'ing-gone', label: '', percent: 2, grams: 17 }],
      }),
    );

    await waitFor(() => expect(screen.getByTestId('batch-quantities')).toBeInTheDocument());
    expect(screen.getByTestId('batch-quantities')).toHaveTextContent('no longer in the recipe');
  });

  it('says out loud that these numbers do not move when the recipe does', async () => {
    renderPage();
    mockBatch._set(makeBatch());
    await waitFor(() => expect(screen.getByTestId('batch-frozen-note')).toBeInTheDocument());
  });

  it('renders the same numbers whatever the recipe now says, because it never reads one', async () => {
    // The strongest form of the freeze assertion available to a unit test: the page
    // is rendered with no recipe store and no formula store mocked at all. If it
    // ever reached for either, this test would not run.
    renderPage();
    mockBatch._set(makeBatch());

    await waitFor(() => expect(screen.getByTestId('batch-quantities')).toBeInTheDocument());
    expect(gramsColumn()).toEqual(['841 g', '589 g', '17 g', '12 g', '25 g']);
  });
});

describe('BatchDetailPage — the schedule', () => {
  it('lists the stages in order, timed forward from the start that was chosen', async () => {
    renderPage();
    mockBatch._set(makeBatch());

    await waitFor(() => expect(screen.getByTestId('batch-stages')).toBeInTheDocument());
    const stages = screen.getAllByTestId('batch-stage');
    expect(stages.map((el) => el.getAttribute('data-stage-id'))).toEqual([
      'stage-1',
      'stage-2',
      'stage-3',
    ]);
    // Each stage begins where the previous one ended — the forward anchor.
    expect(stages[0]).toHaveAttribute('data-planned-start', '2026-08-14T07:00:00.000Z');
    expect(stages[0]).toHaveAttribute('data-planned-end', '2026-08-14T07:15:00.000Z');
    expect(stages[1]).toHaveAttribute('data-planned-start', '2026-08-14T07:15:00.000Z');
  });

  it('shows a range as a range beside the single time the schedule committed to', async () => {
    // `resolveSchedule` plans a range at its LONG end and the frozen stage keeps the
    // whole span, precisely so this screen can say both. Collapsing either would
    // throw away what the schema went out of its way to preserve.
    renderPage();
    mockBatch._set(makeBatch());

    await waitFor(() => expect(screen.getByTestId('batch-stages')).toBeInTheDocument());
    const bulk = screen.getAllByTestId('batch-stage')[1]!;
    expect(bulk.querySelector('[data-testid="batch-stage-stated"]')).toHaveTextContent(
      '45 min – 1 h',
    );
    expect(bulk.querySelector('[data-testid="batch-stage-stated"]')).toHaveTextContent(
      'planned at the long end',
    );
    // 07:15 → 08:15 is the long end, an hour.
    expect(bulk).toHaveAttribute('data-planned-end', '2026-08-14T08:15:00.000Z');
  });

  it('reads a stage with no duration as observational, not as an instant', async () => {
    renderPage();
    mockBatch._set(makeBatch());

    await waitFor(() => expect(screen.getByTestId('batch-stages')).toBeInTheDocument());
    const prove = screen.getAllByTestId('batch-stage')[2]!;
    // Same instant either side — the length is not zero, it is unknown.
    expect(prove.getAttribute('data-planned-start')).toEqual(
      prove.getAttribute('data-planned-end'),
    );
    expect(prove.querySelector('[data-testid="batch-stage-observational"]')).not.toBeNull();
    expect(prove.querySelector('[data-testid="batch-stage-end"]')).toBeNull();
    expect(prove.querySelector('[data-testid="batch-stage-until"]')).toHaveTextContent(
      'until doubled',
    );
  });

  it('shows the environment where the stage has one, and nothing where it does not', async () => {
    renderPage();
    mockBatch._set(makeBatch());

    await waitFor(() => expect(screen.getByTestId('batch-stages')).toBeInTheDocument());
    const stages = screen.getAllByTestId('batch-stage');
    expect(stages[1]!.querySelector('[data-testid="batch-stage-environment"]')).toHaveTextContent(
      '20 °C',
    );
    // A mix has no meaningful temperature and is not given an invented one.
    expect(stages[0]!.querySelector('[data-testid="batch-stage-environment"]')).toBeNull();
  });

  it('offers no way to advance a stage or abandon the run in this phase', async () => {
    // Phase 3's controls. Shipping the surface that READS before the one that ACTS
    // is what lets a schedule be checked against a real bake first.
    renderPage();
    mockBatch._set(makeBatch());

    await waitFor(() => expect(screen.getByTestId('batch-stages')).toBeInTheDocument());
    expect(screen.queryByText(/mark.*done/i)).toBeNull();
    expect(screen.queryByText(/abandon/i)).toBeNull();
  });
});
