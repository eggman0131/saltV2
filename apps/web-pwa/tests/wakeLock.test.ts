import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createWakeLock,
  isWakeLockSupported,
  type WakeLockController,
} from '../src/lib/wakeLock.js';

// Screen Wake Lock wrapper. jsdom ships no `navigator.wakeLock`, so every test
// installs a fake platform API and drives it directly: grant, refuse, or hang.
// The wrapper must never throw — a refusal is a boolean, not an exception — and
// it must leave no listener armed behind a UI that says the lock is off (#555).

// ─── Fake platform ──────────────────────────────────────────────────────────────

function makeSentinel() {
  const releaseListeners: Array<() => void> = [];
  let released = false;
  const release = vi.fn(async (): Promise<void> => {
    released = true;
  });
  const sentinel = {
    get released() {
      return released;
    },
    release,
    addEventListener(_type: 'release', listener: () => void) {
      releaseListeners.push(listener);
    },
  };
  return {
    sentinel,
    release,
    // The OS drops the lock whenever the page is hidden; the sentinel then fires
    // its 'release' event. This is what the wrapper recovers from on return.
    dropFromOs() {
      released = true;
      for (const listener of releaseListeners) listener();
    },
  };
}

function installWakeLockApi(request: (type: 'screen') => Promise<unknown>) {
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
  });
}

function grantingApi() {
  const handles = [makeSentinel(), makeSentinel()];
  let issued = 0;
  const request = vi.fn(async (_type: 'screen') => handles[issued++]!.sentinel);
  installWakeLockApi(request);
  return { request, handles };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

// The visibility handler kicks off `acquire()` without awaiting it.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// jsdom's `document` outlives an individual test, so a controller left enabled
// would keep its visibilitychange listener armed and re-acquire against the NEXT
// test's fake platform. Every controller made here is disabled on teardown.
const controllers: WakeLockController[] = [];
function newWakeLock(): WakeLockController {
  const wl = createWakeLock();
  controllers.push(wl);
  return wl;
}

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(async () => {
  for (const wl of controllers.splice(0)) await wl.disable();
  Reflect.deleteProperty(navigator, 'wakeLock');
  Reflect.deleteProperty(document, 'visibilityState');
  vi.restoreAllMocks();
});

describe('isWakeLockSupported', () => {
  it('is true only where the platform exposes the API', () => {
    expect(isWakeLockSupported()).toBe(false);
    grantingApi();
    expect(isWakeLockSupported()).toBe(true);
  });
});

describe('wakeLock — acquiring', () => {
  it('confirms the screen is being kept awake when the platform grants the lock', async () => {
    const { request } = grantingApi();

    await expect(newWakeLock().enable()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith('screen');
  });

  it('does not stack a second lock when enabled twice', async () => {
    const { request } = grantingApi();
    const wl = newWakeLock();

    await expect(wl.enable()).resolves.toBe(true);
    await expect(wl.enable()).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('answers false when the platform refuses, so the caller can correct its UI', async () => {
    const request = vi.fn(() => Promise.reject(new Error('denied')));
    installWakeLockApi(request);

    await expect(newWakeLock().enable()).resolves.toBe(false);
  });

  // The #555 contract: a refusal rolls the controller all the way back, so nothing
  // can quietly grab a lock later behind a toggle the user sees as off.
  it('leaves nothing armed after a refusal — no later visibility change re-tries', async () => {
    const request = vi.fn(() => Promise.reject(new Error('denied')));
    installWakeLockApi(request);

    await newWakeLock().enable();
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('unhooks its visibility listener when the platform refuses', async () => {
    const request = vi.fn(() => Promise.reject(new Error('denied')));
    installWakeLockApi(request);
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');

    await newWakeLock().enable();

    const handler = added.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
    expect(handler).toBeDefined();
    expect(removed).toHaveBeenCalledWith('visibilitychange', handler);
  });

  it('recovers into a working lock after an earlier refusal', async () => {
    const request = vi.fn(() => Promise.reject(new Error('denied')));
    installWakeLockApi(request);
    const wl = newWakeLock();
    await expect(wl.enable()).resolves.toBe(false);

    const { request: granting } = grantingApi();
    await expect(wl.enable()).resolves.toBe(true);
    expect(granting).toHaveBeenCalledTimes(1);
  });

  it('drops a lock that arrives after the user already turned it off', async () => {
    const handle = makeSentinel();
    let grant: (s: unknown) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    installWakeLockApi(request);
    const wl = newWakeLock();

    const pending = wl.enable();
    await wl.disable();
    grant(handle.sentinel);

    await expect(pending).resolves.toBe(false);
    expect(handle.release).toHaveBeenCalled();
  });

  it('degrades to a plain false on a browser without the API, without throwing', async () => {
    const wl = newWakeLock();
    await expect(wl.enable()).resolves.toBe(false);
    await expect(wl.disable()).resolves.toBeUndefined();
  });
});

describe('wakeLock — surviving a backgrounded page', () => {
  it('re-acquires the lock the OS took away while the page was hidden', async () => {
    const { request, handles } = grantingApi();
    await newWakeLock().enable();

    handles[0]!.dropFromOs();
    setVisibility('visible');
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not try to re-acquire while the page is still hidden', async () => {
    const { request, handles } = grantingApi();
    await newWakeLock().enable();

    handles[0]!.dropFromOs();
    setVisibility('hidden');
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('wakeLock — releasing', () => {
  it('gives the lock back and stops keeping the screen awake', async () => {
    const { request, handles } = grantingApi();
    const wl = newWakeLock();
    await wl.enable();

    await wl.disable();

    expect(handles[0]!.release).toHaveBeenCalled();
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('is safe to call when nothing is held', async () => {
    grantingApi();
    const wl = newWakeLock();
    await expect(wl.disable()).resolves.toBeUndefined();
    await wl.enable();
    await wl.disable();
    await expect(wl.disable()).resolves.toBeUndefined();
  });

  it('does not re-release a sentinel the OS already released', async () => {
    const { handles } = grantingApi();
    const wl = newWakeLock();
    await wl.enable();

    handles[0]!.dropFromOs();
    await wl.disable();

    expect(handles[0]!.release).not.toHaveBeenCalled();
  });

  it('survives a platform that throws while releasing', async () => {
    const handle = makeSentinel();
    handle.release.mockRejectedValueOnce(new Error('gone'));
    installWakeLockApi(vi.fn(async () => handle.sentinel));
    const wl = newWakeLock();
    await wl.enable();

    await expect(wl.disable()).resolves.toBeUndefined();
  });
});
