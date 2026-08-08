import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CookActiveTimerDoc, CookSessionDoc } from '@salt/domain/schemas';

// The watcher is a plain module over a clock, so these tests own the clock
// outright: `setInterval` is faked to drive ticks on demand, and `Date.now` is
// spied SEPARATELY (note `toFake` deliberately excludes Date). Keeping them
// independent is the whole point — it is what lets a test move the wall clock
// WITHOUT running a tick, which is exactly what a frozen page does and the one
// case a fully-faked clock cannot express.
const { mockCookSession, mockChime, mockToast, mockRouter } = vi.hoisted(() => {
  let value: CookSessionDoc | null = null;
  return {
    mockCookSession: {
      subscribe(fn: (v: CookSessionDoc | null) => void) {
        fn(value);
        return () => {};
      },
      _set(v: CookSessionDoc | null) {
        value = v;
      },
    },
    mockChime: { playChime: vi.fn(), primeChime: vi.fn() },
    mockToast: { addToast: vi.fn(), dismissToast: vi.fn() },
    mockRouter: { push: vi.fn() },
  };
});

vi.mock('../src/lib/cookSessionService.js', () => ({ cookSession: mockCookSession }));
vi.mock('../src/lib/chime.js', () => mockChime);
vi.mock('../src/lib/toastStore.js', () => mockToast);
vi.mock('svelte-spa-router', () => mockRouter);

import { initCookTimerAlerts } from '../src/lib/cookTimerAlerts.js';

const RECIPE_ID = 'recipe-1';
const UID = 'user-1';
const COOK_HASH = `#/recipes/${RECIPE_ID}/cook`;
const START = 1_800_000_000_000;

let clock = START;
const iso = (ms: number) => new Date(ms).toISOString();

function makeSession(activeTimers: CookActiveTimerDoc[]): CookSessionDoc {
  return {
    id: `${RECIPE_ID}_${UID}`,
    schemaVersion: 1,
    ownerUid: UID,
    recipeId: RECIPE_ID,
    recipeUpdatedAtAtStart: iso(START - 3_600_000),
    checkedIngredientIds: [],
    completedStepIds: [],
    activeTimers,
    createdAt: iso(START - 60_000),
    updatedAt: iso(START - 60_000),
  };
}

function makeTimer(overrides: Partial<CookActiveTimerDoc> = {}): CookActiveTimerDoc {
  return {
    id: 'step-2',
    stepId: 'step-2',
    label: null,
    durationMinutes: null,
    endsAt: iso(START + 60_000),
    notify: true,
    ...overrides,
  };
}

/** A timer running with a minute left when the watcher starts. */
function runningTimer(): CookActiveTimerDoc {
  return makeTimer();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  clock = START;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  mockCookSession._set(null);
  // Somewhere else in the app — the case the watcher exists for.
  window.location.hash = '#/shopping';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('cookTimerAlerts', () => {
  it('chimes and offers a way back when a timer it watched runs out', () => {
    mockCookSession._set(makeSession([runningTimer()]));
    const stop = initCookTimerAlerts();
    expect(mockChime.playChime).not.toHaveBeenCalled();

    clock = START + 60_400;
    vi.advanceTimersByTime(1_000);

    expect(mockChime.playChime).toHaveBeenCalledTimes(1);
    expect(mockToast.addToast).toHaveBeenCalledTimes(1);

    // The toast is the only route back from wherever the chef had wandered to.
    const options = mockToast.addToast.mock.calls[0]?.[2] as {
      action: { label: string; onClick: () => void };
    };
    options.action.onClick();
    expect(mockRouter.push).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}/cook`);

    stop();
  });

  it('chimes without a toast when the chef is already watching the cook page', () => {
    window.location.hash = COOK_HASH;
    mockCookSession._set(makeSession([runningTimer()]));
    const stop = initCookTimerAlerts();

    clock = START + 60_400;
    vi.advanceTimersByTime(1_000);

    // The chip on that page flips to "Finished" on its own, so a toast would add
    // nothing and would sit over its Dismiss button.
    expect(mockChime.playChime).toHaveBeenCalledTimes(1);
    expect(mockToast.addToast).not.toHaveBeenCalled();

    stop();
  });

  it('stays silent for a timer that ran out while the page was frozen', () => {
    mockCookSession._set(makeSession([runningTimer()]));
    const stop = initCookTimerAlerts();

    // iOS suspends a backgrounded PWA: the wall clock keeps moving but no tick
    // runs, so the watcher resumes to find the timer long finished. No window
    // client was visible, so push-sw.js did not suppress and the chef already got
    // the OS notification.
    clock = START + 180_000;
    vi.advanceTimersByTime(1_000);

    expect(mockChime.playChime).not.toHaveBeenCalled();
    expect(mockToast.addToast).not.toHaveBeenCalled();

    stop();
  });

  it('stays silent for a timer that had already finished when it started', () => {
    // A fresh app load, or a cook picked up on another device — never seen
    // running here, so never ours to announce.
    mockCookSession._set(makeSession([makeTimer({ endsAt: iso(START - 30_000) })]));
    const stop = initCookTimerAlerts();

    vi.advanceTimersByTime(5_000);

    expect(mockChime.playChime).not.toHaveBeenCalled();

    stop();
  });

  it('alerts once, not on every tick after the timer finishes', () => {
    mockCookSession._set(makeSession([runningTimer()]));
    const stop = initCookTimerAlerts();

    clock = START + 60_400;
    vi.advanceTimersByTime(1_000);
    expect(mockChime.playChime).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 5; i++) {
      clock = START + 60_400 + i * 1_000;
      vi.advanceTimersByTime(1_000);
    }
    expect(mockChime.playChime).toHaveBeenCalledTimes(1);
    expect(mockToast.addToast).toHaveBeenCalledTimes(1);

    stop();
  });

  it('treats an adjusted timer as a new one to announce', () => {
    mockCookSession._set(makeSession([runningTimer()]));
    const stop = initCookTimerAlerts();

    clock = START + 60_400;
    vi.advanceTimersByTime(1_000);
    expect(mockChime.playChime).toHaveBeenCalledTimes(1);

    // Adjusting rewrites `endsAt`, which is part of the key — so the same timer
    // alerts again when its new end-time lands.
    mockCookSession._set(makeSession([makeTimer({ endsAt: iso(START + 120_000) })]));
    clock = START + 61_000;
    vi.advanceTimersByTime(1_000);
    clock = START + 120_400;
    vi.advanceTimersByTime(1_000);

    expect(mockChime.playChime).toHaveBeenCalledTimes(2);

    stop();
  });

  it('stops ticking once torn down', () => {
    mockCookSession._set(makeSession([runningTimer()]));
    const stop = initCookTimerAlerts();
    stop();

    clock = START + 60_400;
    vi.advanceTimersByTime(5_000);

    expect(mockChime.playChime).not.toHaveBeenCalled();
  });
});
