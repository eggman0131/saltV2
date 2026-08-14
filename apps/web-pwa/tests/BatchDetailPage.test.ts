import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { BatchDoc, BatchStageDoc } from '@salt/domain/schemas';

// One run's own screen (issue #812, phases 1 and 3 of epic #778).
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
//
// PHASE 3 adds the controls, and what those tests have to get right is different in
// kind: the page must never decide anything the domain already decides. So they
// assert WHICH stage carries a control and WHAT ARGUMENTS reach the service, and
// never that a schedule moved — the re-timing is `withStageAdvanced`'s and is
// pinned in the domain's own suite, against a fixed clock this page does not read.

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
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/batchService.js', () => ({
  batch: mockBatch,
  initBatchSync: mockInitBatchSync,
  advanceStage: vi.fn(),
  abandonBatch: vi.fn(),
}));

import BatchDetailPage from '../src/routes/batches/BatchDetailPage.svelte';
import { push } from 'svelte-spa-router';
import { abandonBatch, advanceStage } from '../src/lib/batchService.js';
import { addToast } from '../src/lib/toastStore.js';

const pushMock = vi.mocked(push);
const advanceMock = vi.mocked(advanceStage);
const abandonMock = vi.mocked(abandonBatch);
const toastMock = vi.mocked(addToast);

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
  // The happy path by default: every command succeeds and hands the run back, which
  // is what the write path does (`persist` returns the stamped document).
  advanceMock.mockImplementation(async (current) => ({ kind: 'ok', value: current }));
  abandonMock.mockImplementation(async (current) => ({ kind: 'ok', value: current }));
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
});

// ─── Phase 3 ──────────────────────────────────────────────────────────────────

/** Render, hand the store a run, and wait for the stage list. */
async function showRun(over: Partial<BatchDoc> = {}): Promise<BatchDoc> {
  const run = makeBatch(over);
  renderPage();
  mockBatch._set(run);
  await waitFor(() => expect(screen.getByTestId('batch-stages')).toBeInTheDocument());
  return run;
}

/** The stage ids carrying a control block, in the order they render. */
function stagesWithControls(): string[] {
  return screen
    .getAllByTestId('batch-stage')
    .filter((el) => el.querySelector('[data-testid="batch-stage-controls"]') !== null)
    .map((el) => el.getAttribute('data-stage-id') ?? '');
}

// The ⋮ renders its contents only once open (bits-ui mounts PopoverContent
// lazily), so an assertion about what is inside it has to open it first.
async function openOverflowMenu(): Promise<void> {
  await fireEvent.click(screen.getByTestId('batch-actions-overflow'));
  await waitFor(() => expect(screen.getByTestId('batch-abandon-menu-item')).toBeInTheDocument());
}

describe('BatchDetailPage — marking a stage done', () => {
  it('offers the control on the current stage and on no other', async () => {
    // Earlier stages are done and later ones have not happened; neither is a thing
    // you can finish. `currentStage` — through `nextAction` — is the only decision.
    await showRun();

    expect(stagesWithControls()).toEqual(['stage-1']);
  });

  it('moves the control on when the stage before it has been marked done', async () => {
    await showRun({
      stages: [
        stage({ actualEndAt: '2026-08-14T07:12:00.000Z' }),
        stage({ id: 'stage-2', label: 'Bulk ferment', kind: 'wait' }),
        stage({ id: 'stage-3', label: 'Prove', kind: 'wait' }),
      ],
    });

    expect(stagesWithControls()).toEqual(['stage-2']);
  });

  it('marks THAT stage done, and reads no clock of its own doing it', async () => {
    // Two arguments and no third: the instant is the service's to read
    // (`advanceStage` stamps `new Date()`), which is what keeps the re-timing a pure
    // function with a fixed answer.
    const run = await showRun();

    await fireEvent.click(screen.getByTestId('batch-stage-advance'));

    await waitFor(() => expect(advanceMock).toHaveBeenCalledTimes(1));
    expect(advanceMock).toHaveBeenCalledWith(run, 'stage-1');
  });

  it('says so when the write fails, and says nothing when it works', async () => {
    // A stage list that re-times itself in front of you is a better acknowledgement
    // than a sentence covering it up, so success is silent.
    await showRun();
    await fireEvent.click(screen.getByTestId('batch-stage-advance'));
    await waitFor(() => expect(advanceMock).toHaveBeenCalledTimes(1));
    expect(toastMock).not.toHaveBeenCalled();

    advanceMock.mockResolvedValueOnce({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });
    await fireEvent.click(screen.getByTestId('batch-stage-advance'));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0]?.[1]).toBe('destructive');
  });

  it('offers nothing to advance once every stage is done', async () => {
    // There is deliberately no `finished` STATE — "nothing left" is answered by the
    // stages themselves, so it has to be answered here the same way.
    await showRun({
      stages: [
        stage({ actualEndAt: '2026-08-14T07:12:00.000Z' }),
        stage({ id: 'stage-2', actualEndAt: '2026-08-14T08:10:00.000Z' }),
      ],
    });

    expect(screen.queryByTestId('batch-stage-advance')).toBeNull();
  });

  it('offers nothing to advance on an abandoned run', async () => {
    await showRun({ state: 'abandoned' });

    expect(screen.queryByTestId('batch-stage-advance')).toBeNull();
  });
});

describe('BatchDetailPage — the hand-off to cook mode', () => {
  it('links an active stage to cook mode, by recipe id alone', async () => {
    // Cook mode takes only a recipe id — the link lands at the top of it, with its
    // own timers, which is the whole hand-off.
    await showRun();

    await fireEvent.click(screen.getByTestId('batch-stage-cook'));
    expect(pushMock).toHaveBeenCalledWith('/recipes/recipe-1/cook');
  });

  it('does not offer it on a wait, which is the stage you leave the room for', async () => {
    await showRun({
      stages: [
        stage({ actualEndAt: '2026-08-14T07:12:00.000Z' }),
        stage({ id: 'stage-2', label: 'Bulk ferment', kind: 'wait' }),
      ],
    });

    expect(stagesWithControls()).toEqual(['stage-2']);
    expect(screen.queryByTestId('batch-stage-cook')).toBeNull();
  });

  it('links off the batch and never through it — the recipe is not read here', async () => {
    // `recipeId` is the batch's own frozen FK. A run whose dish was retitled or
    // deleted still links, because nothing on this page joins to a recipe.
    await showRun({ recipeId: 'recipe-since-renamed' });

    await fireEvent.click(screen.getByTestId('batch-stage-cook'));
    expect(pushMock).toHaveBeenCalledWith('/recipes/recipe-since-renamed/cook');
  });
});

describe('BatchDetailPage — abandoning', () => {
  it('keeps it behind the ⋮ and behind a confirm', async () => {
    // Two gates for one irreversible action, on a page whose thumb is reaching for
    // "Mark done".
    await showRun();

    expect(screen.queryByTestId('batch-abandon-menu-item')).toBeNull();
    await openOverflowMenu();
    await fireEvent.click(screen.getByTestId('batch-abandon-menu-item'));

    await waitFor(() => expect(screen.getByTestId('batch-abandon-dialog')).toBeInTheDocument());
    expect(abandonMock).not.toHaveBeenCalled();
  });

  it('stops the run once confirmed', async () => {
    const run = await showRun();

    await openOverflowMenu();
    await fireEvent.click(screen.getByTestId('batch-abandon-menu-item'));
    await waitFor(() => expect(screen.getByTestId('batch-abandon-confirm')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('batch-abandon-confirm'));

    await waitFor(() => expect(abandonMock).toHaveBeenCalledTimes(1));
    expect(abandonMock).toHaveBeenCalledWith(run);
  });

  it('is not offered on a run that is already stopped', async () => {
    await showRun({ state: 'abandoned' });

    expect(screen.queryByTestId('batch-actions-overflow')).toBeNull();
  });

  it('is not offered on a run with every stage done — there is nothing left to stop', async () => {
    await showRun({
      stages: [stage({ actualEndAt: '2026-08-14T07:12:00.000Z' })],
    });

    // Still `running`, so the menu stands: the reminders for a run that finished
    // early are gone with its last stage, but the state is what abandoning changes.
    expect(screen.getByTestId('batch-actions-overflow')).toBeInTheDocument();
  });
});

describe('BatchDetailPage — what the controls still refuse to do', () => {
  it('offers no way to re-scale or re-schedule a running batch', async () => {
    // Freezing exists to prevent versions: what a batch records is what happened.
    // There is no route back to `proposeSchedule` from here, and no control that
    // moves a number.
    await showRun();
    await openOverflowMenu();

    expect(screen.queryByText(/re-?schedule|re-?scale|change the (plan|time)/i)).toBeNull();
  });
});
