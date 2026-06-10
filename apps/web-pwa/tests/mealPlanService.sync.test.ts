import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import {
  emptyTemplate,
  emptyWeek,
  setDayNote,
  weekStartFor,
  type MealPlanConfig,
  type MealPlanTemplate,
  type MealPlanWeek,
} from '@salt/domain';

vi.mock('@salt/firebase-sync', () => ({
  subscribeMealPlanConfig: vi.fn(),
  subscribeMealPlanTemplate: vi.fn(),
  subscribeMealPlanWeek: vi.fn(),
  saveMealPlanConfig: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  saveMealPlanTemplate: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  saveMealPlanWeek: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  currentWeek,
  selectedStartDate,
  firstDayOfWeek,
  mealPlanTemplate,
  initMealPlanSync,
  goToWeek,
  nextWeek,
  prevWeek,
  loadTemplateIntoCurrentWeek,
  setWeekDayNote,
  setWeekDayChefs,
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
  const weekUnsub = vi.fn();
  fs.subscribeMealPlanConfig.mockImplementation((on) => {
    configCb = on as ConfigCb;
    return vi.fn();
  });
  fs.subscribeMealPlanTemplate.mockImplementation((on) => {
    templateCb = on as TemplateCb;
    return vi.fn();
  });
  fs.subscribeMealPlanWeek.mockImplementation((_start, on) => {
    weekCb = on as WeekCb;
    return weekUnsub;
  });
  return {
    emitConfig: (c: MealPlanConfig | null) => configCb!(c),
    emitTemplate: (t: MealPlanTemplate | null) => templateCb!(t),
    emitWeek: (w: MealPlanWeek | null) => weekCb!(w),
    weekUnsub,
  };
}

beforeEach(() => {
  __resetMealPlanServiceForTest();
  vi.clearAllMocks();
  fs.saveMealPlanConfig.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.saveMealPlanTemplate.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.saveMealPlanWeek.mockResolvedValue({ kind: 'ok', value: undefined });
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

  it('loadTemplateIntoCurrentWeek instantiates the week from the template and saves', async () => {
    const template = setDayNote(emptyTemplate(), 'mon', 'roast');
    seedMealPlanTemplate(template);
    goToWeek('2026-06-08'); // Monday start

    await loadTemplateIntoCurrentWeek();

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

describe('mealPlanService — week-start helper parity', () => {
  it('uses weekStartFor consistently with the domain', () => {
    expect(weekStartFor('2026-06-10', 'mon')).toBe('2026-06-08');
  });
});
