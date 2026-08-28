import { describe, it, expect, beforeEach, afterEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import {
  emptyWeek,
  setDayNote,
  type MealPlanConfig,
  type MealPlanTemplate,
  type MealPlanWeek,
} from '@salt/domain';

// Write coalescing (issue #940).
//
// The planner used to issue one full-document `setDoc` of the whole seven-day
// week PER KEYSTROKE. These tests pin the two halves of the fix that can each
// silently lose data if the next person gets them wrong:
//
//   1. the write is coalesced — a burst of typing settles into ONE write;
//   2. the optimistic store apply is NOT — it stays synchronous, so interleaved
//      edits to different fields of the same day both survive the single write.
//
// They live beside `mealPlanService.sync.test.ts` and share its harness shape.
vi.mock('@salt/firebase-sync', () => ({
  subscribeMealPlanConfig: vi.fn(),
  subscribeMealPlanTemplate: vi.fn(),
  subscribeMealPlanWeek: vi.fn(),
  loadMealPlanWeek: vi.fn().mockResolvedValue({ kind: 'ok', value: null }),
  saveMealPlanConfig: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  saveMealPlanTemplate: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  saveMealPlanWeek: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  currentWeek,
  mealPlanTemplate,
  initMealPlanSync,
  goToWeek,
  setWeekDayNote,
  setWeekDayGuests,
  setTemplateDayNote,
  flushMealPlanWrites,
  seedMealPlanConfig,
  __resetMealPlanServiceForTest,
} from '../src/lib/mealPlanService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const CONFIG: MealPlanConfig = { firstDayOfWeek: 'mon', schemaVersion: 1 };
const START = '2026-06-08'; // a Monday
const DAY = '2026-06-10'; // the Wednesday of that week

type WeekCb = (w: MealPlanWeek | null) => void;
type TemplateCb = (t: MealPlanTemplate | null) => void;

/** Subscribe to `START` and hand it a real snapshot, so it is a known week. */
function loadWeek(): { emitWeek: WeekCb; emitTemplate: TemplateCb } {
  let weekCb: WeekCb | null = null;
  let templateCb: TemplateCb | null = null;
  fs.subscribeMealPlanConfig.mockImplementation(() => vi.fn());
  fs.subscribeMealPlanTemplate.mockImplementation((on) => {
    templateCb = on as TemplateCb;
    return vi.fn();
  });
  fs.subscribeMealPlanWeek.mockImplementation((_start, on) => {
    weekCb = on as WeekCb;
    return vi.fn();
  });
  seedMealPlanConfig(CONFIG);
  initMealPlanSync();
  goToWeek(START);
  const emitWeek = (w: MealPlanWeek | null) => weekCb!(w);
  emitWeek({ ...emptyWeek(START), updatedAt: '2026-06-01T00:00:00.000Z' });
  return { emitWeek, emitTemplate: (t) => templateCb!(t) };
}

beforeEach(() => {
  __resetMealPlanServiceForTest();
  vi.clearAllMocks();
  fs.saveMealPlanTemplate.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.saveMealPlanWeek.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.loadMealPlanWeek.mockResolvedValue({ kind: 'ok', value: null });
});

afterEach(() => {
  __resetMealPlanServiceForTest();
});

describe('mealPlanService — write coalescing', () => {
  it('settles a burst of keystrokes into ONE full-week write carrying the final text', async () => {
    loadWeek();

    // What typing "Pasta" actually looks like at this layer: five calls, one per
    // `input` event, each with the whole field value so far. Before #940 this
    // was five `saveMealPlanWeek` calls of the entire seven-day document.
    const inFlight = ['P', 'Pa', 'Pas', 'Past', 'Pasta'].map((text) => setWeekDayNote(DAY, text));
    expect(fs.saveMealPlanWeek).not.toHaveBeenCalled();

    await flushMealPlanWrites();

    expect(fs.saveMealPlanWeek).toHaveBeenCalledTimes(1);
    expect(fs.saveMealPlanWeek.mock.calls[0]![0]!.days[DAY]!.note).toBe('Pasta');
    // Every keystroke's caller still gets a result to raise (or not raise) its
    // toast on — they share the one write's outcome (Rule 10).
    for (const result of await Promise.all(inFlight)) expect(result.kind).toBe('ok');
  });

  it('keeps the optimistic store apply synchronous, so the field never lags the caret', () => {
    loadWeek();

    void setWeekDayNote(DAY, 'Pasta');

    // No await: the store must already hold it. `MealDayDetail`'s auto-grow
    // effect tracks `day.note`, so a deferred apply would visibly stall the
    // textarea's height behind the typing (issue #940, D3).
    expect(get(currentWeek).days[DAY]!.note).toBe('Pasta');
  });

  it('does not lose an interleaved edit to a DIFFERENT field of the same day', async () => {
    loadWeek();

    // The trap: every mutator rebuilds the week from the store. If the apply
    // were deferred alongside the write, the guests edit would rebuild from the
    // pre-note week and the note would vanish on the single flush.
    void setWeekDayNote(DAY, 'Pasta');
    void setWeekDayGuests(DAY, 3);
    await flushMealPlanWrites();

    expect(fs.saveMealPlanWeek).toHaveBeenCalledTimes(1);
    const saved = fs.saveMealPlanWeek.mock.calls[0]![0]!;
    expect(saved.days[DAY]!.note).toBe('Pasta');
    expect(saved.days[DAY]!.guests).toBe(3);
  });

  it('coalesces two days of the same week into one document write', async () => {
    loadWeek();

    void setWeekDayNote(DAY, 'Pasta');
    void setWeekDayNote('2026-06-11', 'Curry');
    await flushMealPlanWrites();

    expect(fs.saveMealPlanWeek).toHaveBeenCalledTimes(1);
    const saved = fs.saveMealPlanWeek.mock.calls[0]![0]!;
    expect(saved.days[DAY]!.note).toBe('Pasta');
    expect(saved.days['2026-06-11']!.note).toBe('Curry');
  });

  it('flushes on demand rather than waiting out the window (blur, teardown)', async () => {
    loadWeek();

    const pending = setWeekDayNote(DAY, 'Pasta');
    await flushMealPlanWrites();

    // Resolved already — no fake timers, no waiting on the 400 ms window.
    expect(fs.saveMealPlanWeek).toHaveBeenCalledTimes(1);
    expect((await pending).kind).toBe('ok');
  });

  it('flushes without the window when left alone, so an unblurred edit still lands', async () => {
    loadWeek();

    // The e2e types with `page.fill()` and never blurs (`e2e/mealplan.spec.ts`),
    // so the timer — not the flush call — is what has to carry that edit.
    await setWeekDayNote(DAY, 'Pasta');

    expect(fs.saveMealPlanWeek).toHaveBeenCalledTimes(1);
    expect(fs.saveMealPlanWeek.mock.calls[0]![0]!.days[DAY]!.note).toBe('Pasta');
  });

  it('resolves a Failure to every caller in the burst, so the toast still fires', async () => {
    loadWeek();
    fs.saveMealPlanWeek.mockResolvedValue({
      kind: 'err',
      error: { kind: 'SyncError', reason: 'push-failed' },
    });

    const first = setWeekDayNote(DAY, 'Pas');
    const second = setWeekDayNote(DAY, 'Pasta');
    await flushMealPlanWrites();

    expect((await first).kind).toBe('err');
    expect((await second).kind).toBe('err');
  });

  it('starts a fresh write for an edit made while the previous one is in flight', async () => {
    loadWeek();
    let release!: () => void;
    fs.saveMealPlanWeek.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ kind: 'ok', value: undefined });
        }),
    );

    void setWeekDayNote(DAY, 'Pasta');
    const firstFlush = flushMealPlanWrites();
    // The first write is on the wire and cannot carry this; it must open its own.
    void setWeekDayNote(DAY, 'Pasta bake');
    release();
    await firstFlush;
    await flushMealPlanWrites();

    expect(fs.saveMealPlanWeek).toHaveBeenCalledTimes(2);
    expect(fs.saveMealPlanWeek.mock.calls[1]![0]!.days[DAY]!.note).toBe('Pasta bake');
  });

  it('coalesces template writes on their own document key', async () => {
    const { emitTemplate } = loadWeek();
    emitTemplate(null);

    void setTemplateDayNote('fri', 'Piz');
    void setTemplateDayNote('fri', 'Pizza');
    // The template store is applied synchronously too — the editor reads it back.
    expect(get(mealPlanTemplate)!.days.fri!.note).toBe('Pizza');
    expect(fs.saveMealPlanTemplate).not.toHaveBeenCalled();

    await flushMealPlanWrites();

    expect(fs.saveMealPlanTemplate).toHaveBeenCalledTimes(1);
    expect(fs.saveMealPlanTemplate.mock.calls[0]![0]!.days.fri!.note).toBe('Pizza');
  });

  it('still refuses a week it has never read, before anything is queued', async () => {
    loadWeek();

    const result = await setWeekDayNote('2026-09-02', 'Pasta');

    expect(result.kind).toBe('err');
    await flushMealPlanWrites();
    expect(fs.saveMealPlanWeek).not.toHaveBeenCalled();
  });

  it('writes out a pending edit when the week is dropped rather than discarding it', async () => {
    loadWeek();

    void setWeekDayNote(DAY, 'Pasta');
    // Navigating far enough away prunes the subscription to START, and the
    // service forgets the week. Deliberately NOT followed by an explicit flush:
    // the pruning itself has to issue the write, or the edit is gone.
    goToWeek('2026-09-07');
    await Promise.resolve();

    expect(fs.saveMealPlanWeek).toHaveBeenCalledTimes(1);
    expect(fs.saveMealPlanWeek.mock.calls[0]![0]!.days[DAY]!.note).toBe('Pasta');
  });
});
