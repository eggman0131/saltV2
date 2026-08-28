import { describe, it, expect, beforeEach, afterEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import { render, cleanup } from '@testing-library/svelte';
import type { DomainError } from '@salt/shared-types';
import type { ShoppingDayDoc, WeatherForecast } from '@salt/domain/schemas';

// Issue #1053 — the twelve subscription onError callbacks that used to report
// NOTHING. Whether a stream failure reached PostHog depended on which call site
// had remembered to report it, and eight files had not: appSettings,
// devSettings, equipment + its icons, every meal-plan document, the roster, the
// shop-day markers and the weather cache had no failure telemetry at all.
//
// docs/salt-architecture.md §7.6 says coverage is decided by the error's
// CATEGORY, never by call-site shape. This suite pins that for all twelve: the
// PAYLOAD that reaches the port (UT-A1 — never merely that a spy fired), the two
// suppressions that prove the fix went THROUGH reportSubscriptionError rather
// than around it, and the store work each handler still does afterwards.

// ─── The port, gated by the REAL category predicate ─────────────────────────────
// The services cache getErrorReporter() for the lifetime of the module, so the
// spy has to be stable across the whole file. report() delegates to the actual
// isReportableCategory so "a NetworkError surfaces nothing" exercises the real
// report/suppress boundary instead of a forked copy of it.
const { reportSpy } = vi.hoisted(() => ({ reportSpy: vi.fn() }));

vi.mock('@salt/observability', async () => {
  const actual = await vi.importActual<typeof import('@salt/observability')>('@salt/observability');
  return {
    ...actual,
    createObservabilityErrorReportingAdapter: vi.fn(() => ({
      report: (error: unknown, category: DomainError['kind']) => {
        if (!actual.isReportableCategory(category)) return;
        reportSpy(error, category);
      },
    })),
  };
});

// ─── The adapter surface ────────────────────────────────────────────────────────
// Every subscription records the arguments it was called with. The error handler
// is the LAST argument at all ten of these signatures, which is what lets one
// recorder serve rows whose onError sits at index 1, 2 or 3.
const subscriptionCalls = new Map<string, unknown[][]>();

function recorder(name: string) {
  return vi.fn((...args: unknown[]) => {
    const calls = subscriptionCalls.get(name) ?? [];
    calls.push(args);
    subscriptionCalls.set(name, calls);
    return vi.fn();
  });
}

vi.mock('@salt/firebase-sync', () => ({
  subscribeAppSettings: recorder('subscribeAppSettings'),
  subscribeDevSettings: recorder('subscribeDevSettings'),
  subscribeEquipmentManifest: recorder('subscribeEquipmentManifest'),
  subscribeEquipmentIcons: recorder('subscribeEquipmentIcons'),
  subscribeMealPlanConfig: recorder('subscribeMealPlanConfig'),
  subscribeMealPlanTemplate: recorder('subscribeMealPlanTemplate'),
  subscribeMealPlanWeek: recorder('subscribeMealPlanWeek'),
  subscribeMembers: recorder('subscribeMembers'),
  subscribeShoppingDaysInRange: recorder('subscribeShoppingDaysInRange'),
  subscribeWeatherForecast: recorder('subscribeWeatherForecast'),
  isAuthTransitioning: vi.fn(() => false),
  saveAppSettings: vi.fn(),
  saveDevSettings: vi.fn(),
  saveEquipmentManifest: vi.fn(),
  callIdentifyEquipment: vi.fn(),
  callPopulateEquipmentEntry: vi.fn(),
  callDrawEquipmentIcon: vi.fn(),
  callDescribeEquipmentSubject: vi.fn(),
  upsertMember: vi.fn(),
  deleteMember: vi.fn(),
  loadMealPlanWeek: vi.fn().mockResolvedValue({ kind: 'ok', value: null }),
  saveMealPlanConfig: vi.fn(),
  saveMealPlanTemplate: vi.fn(),
  saveMealPlanWeek: vi.fn(),
  saveShoppingDay: vi.fn(),
  deleteShoppingDay: vi.fn(),
  callRefreshWeatherForecast: vi.fn(),
}));

vi.mock('../src/lib/auth.svelte.js', () => ({
  auth: { user: { uid: 'uid-a', email: 'a@e.org' } },
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  initAppSettingsSync,
  isAppSettingsCorrupt,
  __resetAppSettingsServiceForTest,
} from '../src/lib/appSettingsService.js';
import {
  initDevSettingsSync,
  isLoadingDevSettings,
  __resetDevSettingsServiceForTest,
} from '../src/lib/devSettingsService.js';
import {
  initEquipmentSync,
  isLoadingEquipment,
  __resetEquipmentServiceForTest,
} from '../src/lib/equipmentService.js';
import {
  initMembersSync,
  isLoadingMembers,
  __resetMembersServiceForTest,
} from '../src/lib/membersService.js';
import {
  initMealPlanSync,
  isLoadingMealPlanWeek,
  __resetMealPlanServiceForTest,
} from '../src/lib/mealPlanService.js';
import {
  initShoppingDaySync,
  weekShopDay,
  upcomingShopDay,
  seedWeekShopDay,
  seedUpcomingShopDay,
  __resetShoppingDayServiceForTest,
} from '../src/lib/shoppingDayService.js';
import {
  initWeatherSync,
  weatherForecast,
  __resetWeatherServiceForTest,
} from '../src/lib/weatherService.js';
import WeatherForecastField from '../src/routes/admin/WeatherForecastField.svelte';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const STORAGE_ERR: DomainError = { kind: 'StorageError', reason: 'corruption' };
const NETWORK_ERR: DomainError = { kind: 'NetworkError', reason: 'offline' };
const AUTH_ERR: DomainError = { kind: 'AuthError', reason: 'forbidden' };

type ErrorHandler = (err: DomainError, rawError?: unknown) => void;

// The onError argument of the nth call to `name`. `which` is 'first' or 'last'
// because two rows share one adapter function (the shop-day service opens a
// planner-week range read and an upcoming-shop range read through the same one).
function handlerFor(name: string, which: 'first' | 'last' = 'first'): ErrorHandler {
  const calls = subscriptionCalls.get(name) ?? [];
  expect(calls.length, `${name} was never subscribed`).toBeGreaterThan(0);
  const args = (which === 'first' ? calls[0] : calls[calls.length - 1]) ?? [];
  const handler = args[args.length - 1];
  expect(typeof handler, `${name}'s last argument is not a handler`).toBe('function');
  return handler as ErrorHandler;
}

const MARKER: ShoppingDayDoc = {
  date: '2026-08-15',
  slot: 'am',
  schemaVersion: 1,
  setBy: 'Ann',
  setAt: '2026-08-14T06:00:00.000Z',
};
const FORECAST: WeatherForecast = {
  days: {},
  fetchedAt: 1_755_144_000_000,
  location: { latitude: 51.5, longitude: -0.1, timezone: 'Europe/London', label: 'Home' },
  timezone: 'Europe/London',
};

// ─── The twelve ─────────────────────────────────────────────────────────────────
// One row per previously-silent call site. `drive` opens the subscription; the
// test then fires the error the adapter would have delivered.
const SITES: {
  site: string;
  fn: string;
  which?: 'first' | 'last';
  drive: () => void;
}[] = [
  {
    site: 'appSettingsService — appSettings doc',
    fn: 'subscribeAppSettings',
    drive: initAppSettingsSync,
  },
  {
    site: 'devSettingsService — devSettings doc',
    fn: 'subscribeDevSettings',
    drive: initDevSettingsSync,
  },
  {
    site: 'equipmentService — equipment manifest',
    fn: 'subscribeEquipmentManifest',
    drive: initEquipmentSync,
  },
  {
    site: 'equipmentService — equipment icons',
    fn: 'subscribeEquipmentIcons',
    drive: initEquipmentSync,
  },
  { site: 'mealPlanService — week document', fn: 'subscribeMealPlanWeek', drive: initMealPlanSync },
  { site: 'mealPlanService — config', fn: 'subscribeMealPlanConfig', drive: initMealPlanSync },
  { site: 'mealPlanService — template', fn: 'subscribeMealPlanTemplate', drive: initMealPlanSync },
  { site: 'membersService — roster', fn: 'subscribeMembers', drive: initMembersSync },
  {
    site: 'shoppingDayService — planner week markers',
    fn: 'subscribeShoppingDaysInRange',
    which: 'first',
    // The planner-week read only opens once mealPlanService has published a
    // selected week; the shop-day service deliberately owns no week navigation.
    drive: () => {
      initMealPlanSync();
      initShoppingDaySync();
    },
  },
  {
    site: 'shoppingDayService — upcoming shop',
    fn: 'subscribeShoppingDaysInRange',
    which: 'last',
    drive: initShoppingDaySync,
  },
  {
    site: 'weatherService — forecast cache',
    fn: 'subscribeWeatherForecast',
    drive: initWeatherSync,
  },
  {
    site: 'WeatherForecastField.svelte — admin readout',
    fn: 'subscribeWeatherForecast',
    drive: () => {
      render(WeatherForecastField);
    },
  },
];

function resetAll(): void {
  __resetAppSettingsServiceForTest();
  __resetDevSettingsServiceForTest();
  __resetEquipmentServiceForTest();
  __resetMembersServiceForTest();
  __resetMealPlanServiceForTest();
  __resetShoppingDayServiceForTest();
  __resetWeatherServiceForTest();
  subscriptionCalls.clear();
  reportSpy.mockReset();
  fs.isAuthTransitioning.mockReturnValue(false);
}

describe('subscription onError reporting — the twelve previously-silent sites (#1053)', () => {
  beforeEach(resetAll);
  afterEach(() => {
    cleanup();
    resetAll();
  });

  it('covers every site the issue enumerated', () => {
    expect(SITES).toHaveLength(12);
  });

  it.each(SITES)('$site reports a StorageError to the category gate', ({ fn, which, drive }) => {
    drive();
    handlerFor(fn, which)(STORAGE_ERR);
    expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
  });

  it.each(SITES)(
    '$site forwards the RAW error when the adapter supplies one',
    ({ fn, which, drive }) => {
      const raw = new Error('FirebaseError: permission-denied');
      drive();
      handlerFor(fn, which)(STORAGE_ERR, raw);
      expect(reportSpy).toHaveBeenCalledWith(raw, 'StorageError');
    },
  );

  // ─── The two suppressions ─────────────────────────────────────────────────────
  // Together these are the proof the fix routes through reportSubscriptionError:
  // a site calling errors.report() directly would pass the first and fail the
  // second, and a site that forked the category list would fail the first.

  it.each(SITES)(
    '$site surfaces NOTHING for a NetworkError (gate suppresses)',
    ({ fn, which, drive }) => {
      drive();
      handlerFor(fn, which)(NETWORK_ERR);
      expect(reportSpy).not.toHaveBeenCalled();
    },
  );

  it.each(SITES)(
    '$site surfaces NOTHING for the sign-out AuthError race',
    ({ fn, which, drive }) => {
      fs.isAuthTransitioning.mockReturnValue(true);
      drive();
      handlerFor(fn, which)(AUTH_ERR);
      expect(reportSpy).not.toHaveBeenCalled();
    },
  );

  it.each(SITES)(
    '$site DOES report an AuthError outside the teardown race',
    ({ fn, which, drive }) => {
      drive();
      handlerFor(fn, which)(AUTH_ERR);
      expect(reportSpy).toHaveBeenCalledWith(AUTH_ERR, 'AuthError');
    },
  );

  it.each(SITES)('$site attaches no properties bag beyond the category', ({ fn, which, drive }) => {
    drive();
    handlerFor(fn, which)(STORAGE_ERR);
    expect(reportSpy.mock.calls[0]).toHaveLength(2);
  });
});

// ─── Store behaviour is byte-for-byte what it was ───────────────────────────────
// Reporting is a pure side-effect added AHEAD of the existing work. Each of these
// asserts the work still happens, and the two "keeps its last-known value" rows
// assert the handlers that deliberately do nothing still do nothing.
describe('converted handlers keep their existing store behaviour (#1053)', () => {
  beforeEach(resetAll);
  afterEach(() => {
    cleanup();
    resetAll();
  });

  it('appSettings flags corruption on a corrupt document', () => {
    initAppSettingsSync();
    handlerFor('subscribeAppSettings')(STORAGE_ERR);
    expect(get(isAppSettingsCorrupt)).toBe(true);
  });

  it('devSettings clears its loading flag', () => {
    initDevSettingsSync();
    handlerFor('subscribeDevSettings')(STORAGE_ERR);
    expect(get(isLoadingDevSettings)).toBe(false);
  });

  it('equipment clears its loading flag', () => {
    initEquipmentSync();
    handlerFor('subscribeEquipmentManifest')(STORAGE_ERR);
    expect(get(isLoadingEquipment)).toBe(false);
  });

  it('members clears its loading flag', () => {
    initMembersSync();
    handlerFor('subscribeMembers')(STORAGE_ERR);
    expect(get(isLoadingMembers)).toBe(false);
  });

  it('the meal-plan week clears its loading flag', () => {
    initMealPlanSync();
    handlerFor('subscribeMealPlanWeek')(STORAGE_ERR);
    expect(get(isLoadingMealPlanWeek)).toBe(false);
  });

  it('the shop-day marker keeps its last-known value', () => {
    initMealPlanSync();
    initShoppingDaySync();
    // Seed AFTER init: the service follows the planner's selected week, and
    // initShoppingDaySync re-publishes it over anything seeded beforehand.
    seedWeekShopDay(MARKER);
    handlerFor('subscribeShoppingDaysInRange', 'first')(STORAGE_ERR);
    expect(get(weekShopDay)).toEqual(MARKER);
  });

  it('the upcoming shop keeps its last-known value', () => {
    seedUpcomingShopDay(MARKER);
    initShoppingDaySync();
    handlerFor('subscribeShoppingDaysInRange', 'last')(STORAGE_ERR);
    expect(get(upcomingShopDay)).toEqual(MARKER);
  });

  it('the weather cache keeps its last-known forecast', () => {
    initWeatherSync();
    const [onSnapshot] = subscriptionCalls.get('subscribeWeatherForecast')?.[0] ?? [];
    (onSnapshot as (f: WeatherForecast | null) => void)(FORECAST);
    handlerFor('subscribeWeatherForecast')(STORAGE_ERR);
    expect(get(weatherForecast)).toEqual(FORECAST);
  });
});
