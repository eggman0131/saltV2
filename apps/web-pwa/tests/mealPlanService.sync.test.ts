import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import {
  emptyTemplate,
  emptyWeek,
  setDayNote,
  setDayRecipes,
  weekStartFor,
  type MealPlanConfig,
  type MealPlanTemplate,
  type MealPlanWeek,
} from '@salt/domain';

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
  extensionWeek,
  selectedStartDate,
  extensionStartDate,
  firstDayOfWeek,
  mealPlanTemplate,
  initMealPlanSync,
  goToWeek,
  nextWeek,
  prevWeek,
  setExtensionWeek,
  loadTemplateIntoWeek,
  weekHasEdits,
  addRecipeToDay,
  setWeekDayNote,
  setWeekDayChefs,
  setWeekDayGuests,
  addWeekAttendee,
  saveFirstDayOfWeek,
  setTemplateDayNote,
  seedMealPlanConfig,
  seedMealPlanTemplate,
  seedMealPlanWeek,
  getMealPlanWeekSnapshot,
  __resetMealPlanServiceForTest,
} from '../src/lib/mealPlanService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

type WeekCb = (w: MealPlanWeek | null) => void;
type ConfigCb = (c: MealPlanConfig | null) => void;
type TemplateCb = (t: MealPlanTemplate | null) => void;

const CONFIG: MealPlanConfig = { firstDayOfWeek: 'mon', schemaVersion: 1 };

function wireSubscriptions() {
  let weekCb: WeekCb | null = null;
  let configCb: ConfigCb | null = null;
  let templateCb: TemplateCb | null = null;
  // Every week subscription's callback, keyed by the start date it was opened
  // for — with two weeks held at once, "the week callback" is not one thing.
  const weekCbs = new Map<string, WeekCb>();
  const weekUnsub = vi.fn();
  fs.subscribeMealPlanConfig.mockImplementation((on) => {
    configCb = on as ConfigCb;
    return vi.fn();
  });
  fs.subscribeMealPlanTemplate.mockImplementation((on) => {
    templateCb = on as TemplateCb;
    return vi.fn();
  });
  fs.subscribeMealPlanWeek.mockImplementation((start, on) => {
    weekCb = on as WeekCb;
    weekCbs.set(start, on as WeekCb);
    return weekUnsub;
  });
  return {
    emitConfig: (c: MealPlanConfig | null) => configCb!(c),
    emitTemplate: (t: MealPlanTemplate | null) => templateCb!(t),
    emitWeek: (w: MealPlanWeek | null) => weekCb!(w),
    emitWeekFor: (start: string, w: MealPlanWeek | null) => weekCbs.get(start)!(w),
    weekUnsub,
  };
}

// A week whose Monday carries `note`, stamped at `updatedAt`.
function weekWithNote(start: string, note: string, updatedAt: string): MealPlanWeek {
  return { ...setDayNote(emptyWeek(start), start, note), updatedAt };
}

beforeEach(() => {
  __resetMealPlanServiceForTest();
  vi.clearAllMocks();
  fs.saveMealPlanConfig.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.saveMealPlanTemplate.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.saveMealPlanWeek.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.loadMealPlanWeek.mockResolvedValue({ kind: 'ok', value: null });
});

describe('mealPlanService — subscriptions', () => {
  it('subscribes to config, template and the current week on init', () => {
    wireSubscriptions();
    initMealPlanSync();
    expect(fs.subscribeMealPlanConfig).toHaveBeenCalledTimes(1);
    expect(fs.subscribeMealPlanTemplate).toHaveBeenCalledTimes(1);
    expect(fs.subscribeMealPlanWeek).toHaveBeenCalled();
  });

  it('presents an empty week when the week doc does not exist', () => {
    const { emitWeek } = wireSubscriptions();
    initMealPlanSync();
    emitWeek(null);
    const week = get(currentWeek);
    expect(Object.keys(week.days)).toHaveLength(7);
    expect(week.updatedAt).toBe('');
  });

  it('ignores a stale week snapshot that predates a newer local edit', () => {
    const { emitWeek } = wireSubscriptions();
    initMealPlanSync();
    seedMealPlanConfig(CONFIG);
    goToWeek('2026-06-08');
    const start = '2026-06-08';
    const chefWeek = (chefs: string[], updatedAt: string): MealPlanWeek => ({
      ...emptyWeek(start),
      days: {
        ...emptyWeek(start).days,
        [start]: { note: '', recipeIds: [], chefs, attendees: [], guests: 0 },
      },
      updatedAt,
    });

    // Initial doc has alice as chef (older timestamp).
    emitWeek(chefWeek(['alice@e.org'], '2026-06-08T10:00:00.000Z'));
    expect(getMealPlanWeekSnapshot().days[start]!.chefs).toEqual(['alice@e.org']);

    // Local deselect → optimistic update stamps a newer updatedAt.
    void setWeekDayChefs(start, []);
    expect(getMealPlanWeekSnapshot().days[start]!.chefs).toEqual([]);

    // A stale in-flight snapshot echo of the OLD chef state must be ignored.
    emitWeek(chefWeek(['alice@e.org'], '2026-06-08T10:00:00.000Z'));
    expect(getMealPlanWeekSnapshot().days[start]!.chefs).toEqual([]);
  });

  it('re-subscribes when firstDayOfWeek changes which date the week starts on', () => {
    const { emitConfig } = wireSubscriptions();
    initMealPlanSync();
    goToWeek('2026-06-10'); // Wednesday
    const monStart = get(selectedStartDate);
    expect(monStart).toBe('2026-06-08'); // default mon

    emitConfig({ firstDayOfWeek: 'wed', schemaVersion: 1 });
    expect(get(firstDayOfWeek)).toBe('wed');
    expect(get(selectedStartDate)).toBe('2026-06-10'); // week now starts Wed
  });
});

describe('mealPlanService — navigation', () => {
  beforeEach(() => {
    wireSubscriptions();
    initMealPlanSync();
    seedMealPlanConfig(CONFIG);
  });

  it('goToWeek computes the Monday start of the anchor date', () => {
    goToWeek('2026-06-10');
    expect(get(selectedStartDate)).toBe('2026-06-08');
  });

  it('nextWeek and prevWeek step a whole week', () => {
    goToWeek('2026-06-10');
    nextWeek();
    expect(get(selectedStartDate)).toBe('2026-06-15');
    prevWeek();
    prevWeek();
    expect(get(selectedStartDate)).toBe('2026-06-01');
  });
});

describe('mealPlanService — mutations', () => {
  beforeEach(() => {
    wireSubscriptions();
    initMealPlanSync();
    seedMealPlanConfig(CONFIG);
  });

  it('loadTemplateIntoWeek instantiates the displayed week from the template and saves', async () => {
    const template = setDayNote(emptyTemplate(), 'mon', 'roast');
    seedMealPlanTemplate(template);
    goToWeek('2026-06-08'); // Monday start

    await loadTemplateIntoWeek('2026-06-08');

    const saved = fs.saveMealPlanWeek.mock.calls[0]![0]!;
    expect(saved.days['2026-06-08']!.note).toBe('roast');
    expect(saved.updatedAt).not.toBe('');
    expect(get(currentWeek).days['2026-06-08']!.note).toBe('roast');
  });

  it('setWeekDayNote persists the edited day and stamps updatedAt', async () => {
    const week = emptyWeek('2026-06-08');
    seedMealPlanWeek(week);

    await setWeekDayNote('2026-06-09', 'pasta');

    const saved = fs.saveMealPlanWeek.mock.calls[0]![0]!;
    expect(saved.days['2026-06-09']!.note).toBe('pasta');
    expect(saved.updatedAt).not.toBe('');
    expect(getMealPlanWeekSnapshot().days['2026-06-09']!.note).toBe('pasta');
  });

  it('saveFirstDayOfWeek writes the config singleton', async () => {
    await saveFirstDayOfWeek('sat');
    expect(fs.saveMealPlanConfig).toHaveBeenCalledWith({
      firstDayOfWeek: 'sat',
      schemaVersion: 1,
    });
  });

  it('setTemplateDayNote persists the template keyed by weekday', async () => {
    seedMealPlanTemplate(emptyTemplate());
    await setTemplateDayNote('fri', 'pizza');
    const saved = fs.saveMealPlanTemplate.mock.calls[0]![0]!;
    expect(saved.days.fri.note).toBe('pizza');
    expect(get(mealPlanTemplate)!.days.fri.note).toBe('pizza');
  });
});

// Issue #639 phase 5: the service can hold two weeks. The target document of an
// edit must come from its DATE KEY, not from whichever week is displayed —
// MealPlanWeek.days is a Record<string, Day>, so a foreign date key written into
// the wrong week's document is silent corruption, not an error.
describe('mealPlanService — two weeks at once', () => {
  const PRIMARY = '2026-06-08'; // Monday
  const EXTENSION = '2026-06-15'; // the Monday after

  function initTwoWeeks() {
    const wired = wireSubscriptions();
    initMealPlanSync();
    seedMealPlanConfig(CONFIG);
    goToWeek(PRIMARY);
    setExtensionWeek(EXTENSION);
    return wired;
  }

  it('opens a second subscription for the extension week without moving the primary one', () => {
    initTwoWeeks();
    const starts = fs.subscribeMealPlanWeek.mock.calls.map((c) => c[0]);
    expect(starts).toContain(PRIMARY);
    expect(starts).toContain(EXTENSION);
    // selectedStartDate/currentWeek keep meaning the primary week.
    expect(get(selectedStartDate)).toBe(PRIMARY);
    expect(get(extensionStartDate)).toBe(EXTENSION);
  });

  it('lands an edit to a date outside the primary week in the CORRECT document', async () => {
    const { emitWeekFor } = initTwoWeeks();
    emitWeekFor(PRIMARY, weekWithNote(PRIMARY, 'roast', '2026-06-08T10:00:00.000Z'));
    emitWeekFor(EXTENSION, weekWithNote(EXTENSION, 'pie', '2026-06-15T10:00:00.000Z'));

    // A Wednesday in the SECOND week.
    await setWeekDayNote('2026-06-17', 'pasta');

    const saved = fs.saveMealPlanWeek.mock.calls.at(-1)![0]!;
    expect(saved.startDate).toBe(EXTENSION);
    expect(saved.id).toBe(EXTENSION);
    expect(saved.days['2026-06-17']!.note).toBe('pasta');
    // The extension week's own content survived — it was read, not fabricated.
    expect(saved.days[EXTENSION]!.note).toBe('pie');
    // And the primary week neither moved nor grew a foreign date key.
    expect(Object.keys(get(currentWeek).days)).not.toContain('2026-06-17');
    expect(get(currentWeek).days[PRIMARY]!.note).toBe('roast');
    expect(get(selectedStartDate)).toBe(PRIMARY);
  });

  it('routes every day mutator by date, not just the note one', async () => {
    const { emitWeekFor } = initTwoWeeks();
    emitWeekFor(PRIMARY, weekWithNote(PRIMARY, 'roast', '2026-06-08T10:00:00.000Z'));
    emitWeekFor(EXTENSION, weekWithNote(EXTENSION, 'pie', '2026-06-15T10:00:00.000Z'));

    await setWeekDayChefs('2026-06-17', ['alice@e.org']);
    await setWeekDayGuests('2026-06-18', 2);
    await addWeekAttendee('2026-06-19', { memberId: 'm1', homeTime: null, note: '' });

    for (const call of fs.saveMealPlanWeek.mock.calls) {
      expect(call[0]!.startDate).toBe(EXTENSION);
    }
  });

  it('keeps the stale-snapshot guard per week, so one week’s edit cannot drop the other’s snapshot', () => {
    const { emitWeekFor } = initTwoWeeks();
    emitWeekFor(PRIMARY, weekWithNote(PRIMARY, 'roast', '2026-06-08T10:00:00.000Z'));

    // A local edit in the EXTENSION week stamps a far newer updatedAt than
    // anything the primary week has seen. A shared watermark would now discard
    // the primary week's next snapshot as "stale".
    void setWeekDayNote('2026-06-17', 'pasta');

    emitWeekFor(PRIMARY, weekWithNote(PRIMARY, 'stew', '2026-06-08T11:00:00.000Z'));
    expect(get(currentWeek).days[PRIMARY]!.note).toBe('stew');
  });

  it('still drops a stale snapshot within the week it belongs to', () => {
    const { emitWeekFor } = initTwoWeeks();
    emitWeekFor(EXTENSION, weekWithNote(EXTENSION, 'pie', '2026-06-15T10:00:00.000Z'));

    void setWeekDayNote(EXTENSION, 'pasta');
    expect(get(extensionWeek)!.days[EXTENSION]!.note).toBe('pasta');

    // An in-flight echo of the pre-edit document must not revert it.
    emitWeekFor(EXTENSION, weekWithNote(EXTENSION, 'pie', '2026-06-15T10:00:00.000Z'));
    expect(get(extensionWeek)!.days[EXTENSION]!.note).toBe('pasta');
  });

  it('refuses to write a week it has never read rather than clobbering it', async () => {
    initTwoWeeks();
    // A date three weeks out: no subscription, no snapshot. Persisting would be
    // a full-document replace built from an empty week, destroying whatever is
    // actually stored there.
    const result = await setWeekDayNote('2026-07-01', 'pasta');

    expect(result.kind).toBe('err');
    expect(fs.saveMealPlanWeek).not.toHaveBeenCalled();
  });

  it('drops the extension subscription when the planner lets the week go', () => {
    const { weekUnsub } = initTwoWeeks();
    weekUnsub.mockClear();

    setExtensionWeek(null);

    expect(weekUnsub).toHaveBeenCalledTimes(1);
    expect(get(extensionWeek)).toBeNull();
    expect(get(selectedStartDate)).toBe(PRIMARY);
  });

  it('loads the template into the week the given date belongs to', async () => {
    const { emitWeekFor } = initTwoWeeks();
    emitWeekFor(EXTENSION, weekWithNote(EXTENSION, 'pie', '2026-06-15T10:00:00.000Z'));
    seedMealPlanTemplate(setDayNote(emptyTemplate(), 'wed', 'curry'));

    await loadTemplateIntoWeek('2026-06-17'); // a Wednesday in the second week

    const saved = fs.saveMealPlanWeek.mock.calls.at(-1)![0]!;
    expect(saved.startDate).toBe(EXTENSION);
    expect(saved.days['2026-06-17']!.note).toBe('curry');
  });
});

// The load-template picker (#639, Phase 7) offers three weeks and warns against
// the ones that would lose work — so this answer has to be right for weeks the
// planner is not holding, and honest when it cannot be got at all.
describe('mealPlanService — weekHasEdits', () => {
  beforeEach(() => {
    wireSubscriptions();
    initMealPlanSync();
    seedMealPlanConfig(CONFIG);
  });

  it('answers from the held document, without a read, when we have one', async () => {
    seedMealPlanWeek(weekWithNote('2026-06-08', 'roast', '2026-06-08T10:00:00.000Z'));

    await expect(weekHasEdits('2026-06-10')).resolves.toEqual({ kind: 'ok', value: true });
    expect(fs.loadMealPlanWeek).not.toHaveBeenCalled();
  });

  it('reads a week it is not holding rather than assuming it is empty', async () => {
    fs.loadMealPlanWeek.mockResolvedValue({
      kind: 'ok',
      value: weekWithNote('2026-06-29', 'pie', '2026-06-29T10:00:00.000Z'),
    });

    await expect(weekHasEdits('2026-06-29')).resolves.toEqual({ kind: 'ok', value: true });
    expect(fs.loadMealPlanWeek).toHaveBeenCalledWith('2026-06-29');
  });

  it('reports a week with no document as unedited', async () => {
    fs.loadMealPlanWeek.mockResolvedValue({ kind: 'ok', value: null });
    await expect(weekHasEdits('2026-06-29')).resolves.toEqual({ kind: 'ok', value: false });
  });

  it('surfaces a failed read instead of claiming the week is clear', async () => {
    fs.loadMealPlanWeek.mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });

    const result = await weekHasEdits('2026-06-29');
    expect(result.kind).toBe('err');
  });

  it('resolves the week the date belongs to, not the date itself', async () => {
    fs.loadMealPlanWeek.mockResolvedValue({ kind: 'ok', value: null });
    await weekHasEdits('2026-07-01'); // a Wednesday
    expect(fs.loadMealPlanWeek).toHaveBeenCalledWith('2026-06-29'); // its Monday
  });
});

// "Add to planner" from the recipe page reaches any date, not just the week the
// planner happens to be holding — so unlike every other day mutator this one
// READS the week it is about to overwrite rather than refusing it, and must not
// leave that one-shot read behind as if it were a live document.
describe('mealPlanService — addRecipeToDay', () => {
  beforeEach(() => {
    wireSubscriptions();
    initMealPlanSync();
    seedMealPlanConfig(CONFIG);
  });

  it('appends to a day of the week already on screen, without a read', async () => {
    seedMealPlanWeek(setDayRecipes(emptyWeek('2026-06-08'), '2026-06-10', ['pie']));

    await expect(addRecipeToDay('2026-06-10', 'roast')).resolves.toEqual({
      kind: 'ok',
      value: 'added',
    });

    expect(fs.loadMealPlanWeek).not.toHaveBeenCalled();
    const saved = fs.saveMealPlanWeek.mock.calls.at(-1)![0]!;
    expect(saved.days['2026-06-10']!.recipeIds).toEqual(['pie', 'roast']);
  });

  it('reads a week it is not holding rather than overwriting its other six days', async () => {
    fs.loadMealPlanWeek.mockResolvedValue({
      kind: 'ok',
      value: weekWithNote('2026-06-29', 'pie', '2026-06-29T10:00:00.000Z'),
    });

    await addRecipeToDay('2026-07-01', 'roast'); // a Wednesday, three weeks out

    expect(fs.loadMealPlanWeek).toHaveBeenCalledWith('2026-06-29'); // its Monday
    const saved = fs.saveMealPlanWeek.mock.calls.at(-1)![0]!;
    expect(saved.startDate).toBe('2026-06-29');
    expect(saved.days['2026-07-01']!.recipeIds).toEqual(['roast']);
    // The rest of the week survived the full-document write.
    expect(saved.days['2026-06-29']!.note).toBe('pie');
  });

  it('does not cache a week it only read, so a later write re-reads it', async () => {
    fs.loadMealPlanWeek.mockResolvedValue({ kind: 'ok', value: null });

    await addRecipeToDay('2026-07-01', 'roast');
    await addRecipeToDay('2026-07-01', 'pie');

    expect(fs.loadMealPlanWeek).toHaveBeenCalledTimes(2);
    // Second write is built on the re-read, not on the first write's leftovers.
    const saved = fs.saveMealPlanWeek.mock.calls.at(-1)![0]!;
    expect(saved.days['2026-07-01']!.recipeIds).toEqual(['pie']);
  });

  it('surfaces a failed read instead of writing over a plan it could not see', async () => {
    fs.loadMealPlanWeek.mockResolvedValue({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });

    const result = await addRecipeToDay('2026-07-01', 'roast');

    expect(result.kind).toBe('err');
    expect(fs.saveMealPlanWeek).not.toHaveBeenCalled();
  });

  it('is idempotent — a dish already on the day is reported, not duplicated', async () => {
    seedMealPlanWeek(setDayRecipes(emptyWeek('2026-06-08'), '2026-06-10', ['roast']));

    await expect(addRecipeToDay('2026-06-10', 'roast')).resolves.toEqual({
      kind: 'ok',
      value: 'already-there',
    });
    expect(fs.saveMealPlanWeek).not.toHaveBeenCalled();
  });

  it('seeds a day the stored week has no key for (firstDayOfWeek moved since)', async () => {
    // A Sunday-start document, read back while the household starts weeks on
    // Monday: the target date is inside the Monday week but absent from the doc.
    fs.loadMealPlanWeek.mockResolvedValue({ kind: 'ok', value: emptyWeek('2026-06-28') });

    await addRecipeToDay('2026-07-05', 'roast');

    const saved = fs.saveMealPlanWeek.mock.calls.at(-1)![0]!;
    expect(saved.days['2026-07-05']).toMatchObject({ recipeIds: ['roast'], attendees: [] });
  });
});

describe('mealPlanService — week-start helper parity', () => {
  it('uses weekStartFor consistently with the domain', () => {
    expect(weekStartFor('2026-06-10', 'mon')).toBe('2026-06-08');
  });
});
