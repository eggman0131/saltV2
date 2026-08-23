import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The push service-worker overlay (public/push-sw.js) is a CLASSIC worker script
// that never runs under the app bundle, so it has no import graph to test
// through: these load the real file and execute it against a fake `self`.
//
// What is pinned here is the two-kind routing added by #629 on top of #544:
//   - the foreground suppression is COOK-TIMER ONLY (a shopping nudge has no
//     in-app equivalent, so suppressing it with the app open would make the
//     reminder vanish silently — the bug this fixes);
//   - `notificationclick` honours an explicit `data.url` and still derives the
//     cook page from `sessionId` when there is none;
//   - `renotify` is payload-driven, so a duplicate shopping push replaces the
//     first silently — which is what lets the reminder skip an exactly-once
//     ledger entirely.

const SW_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../public/push-sw.js');
const SW_SOURCE = readFileSync(SW_PATH, 'utf8');

type Listener = (event: unknown) => void;

interface FakeClient {
  focused?: boolean;
  visibilityState?: string;
  focus?: () => Promise<void>;
  navigate?: (url: string) => Promise<void>;
}

// `renotify` is what makes a re-fired cook timer buzz again rather than replace
// its predecessor silently (#544). It is real and load-bearing, but lib.dom's
// `NotificationOptions` does not name it — so name it here, once, instead of
// casting at every read.
type ShownOptions = NotificationOptions & { renotify?: boolean };

function loadSw(clients: FakeClient[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(
    async (_title: string, _options?: ShownOptions): Promise<void> => undefined,
  );
  const openWindow = vi.fn(async (_url: string) => undefined);
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    clients: {
      matchAll: vi.fn(async () => clients),
      openWindow,
    },
    registration: { showNotification },
  };
  // The only way to run a classic worker script from a module test: compile the
  // real file against a fake `self`, so what is under test is the shipped source.
  new Function('self', SW_SOURCE)(self);
  return { listeners, showNotification, openWindow };
}

// A push event: `waitUntil` collects the handler's promise so the test can await it.
function pushEvent(payload: unknown) {
  const pending: Promise<unknown>[] = [];
  return {
    event: {
      data: { json: () => payload },
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    },
    settle: () => Promise.all(pending),
  };
}

function clickEvent(data: unknown) {
  const pending: Promise<unknown>[] = [];
  return {
    event: {
      notification: { data, close: vi.fn() },
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    },
    settle: () => Promise.all(pending),
  };
}

const COOK_TIMER = {
  type: 'cook-timer',
  tag: 'cook::recipe-1_uid-1',
  sessionId: 'recipe-1_uid-1',
  title: 'Timer finished',
  body: 'A cook timer just finished.',
};

const SHOPPING = {
  type: 'shopping-reminder',
  tag: 'shopping::2026-08-15',
  url: '/#/shopping/list-1',
  title: 'Shopping tomorrow AM',
  body: 'Add anything missing to the list.',
  renotify: false,
};

const BATCH_STAGE = {
  type: 'batch-stage',
  tag: 'batch::batch-1::shape',
  url: '/#/batches/batch-1',
  title: 'Shape into the tin',
  body: 'Overnight white tin',
  renotify: true,
};

const FOCUSED_CLIENT: FakeClient = { focused: true, visibilityState: 'visible' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('push-sw — push', () => {
  it('suppresses a cook timer while a window is focused (the in-app tick alerts)', async () => {
    const { listeners, showNotification } = loadSw([FOCUSED_CLIENT]);
    const { event, settle } = pushEvent(COOK_TIMER);
    listeners.get('push')!(event);
    await settle();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('still shows a shopping reminder while a window is focused', async () => {
    // The #629 fix: a shopping nudge has no in-app equivalent, so a focus-only
    // gate would silently swallow it exactly when the app is open.
    const { listeners, showNotification } = loadSw([FOCUSED_CLIENT]);
    const { event, settle } = pushEvent(SHOPPING);
    listeners.get('push')!(event);
    await settle();
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification.mock.calls[0]![0]).toBe('Shopping tomorrow AM');
  });

  it('shows a cook timer when nothing is focused', async () => {
    const { listeners, showNotification } = loadSw([]);
    const { event, settle } = pushEvent(COOK_TIMER);
    listeners.get('push')!(event);
    await settle();
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('lets a duplicate shopping push replace silently, but re-buzzes a cook timer', async () => {
    const shopping = loadSw([]);
    const { event: sEvent, settle: sSettle } = pushEvent(SHOPPING);
    shopping.listeners.get('push')!(sEvent);
    await sSettle();
    const shoppingOpts = shopping.showNotification.mock.calls[0]![1]!;
    expect(shoppingOpts.renotify).toBe(false);
    expect(shoppingOpts.tag).toBe('shopping::2026-08-15');
    expect(shoppingOpts.data.url).toBe('/#/shopping/list-1');

    const cook = loadSw([]);
    const { event: cEvent, settle: cSettle } = pushEvent(COOK_TIMER);
    cook.listeners.get('push')!(cEvent);
    await cSettle();
    const cookOpts = cook.showNotification.mock.calls[0]![1]!;
    expect(cookOpts.renotify).toBe(true);
  });

  it('still shows a batch stage reminder while a window is focused', async () => {
    // #812: nobody is staring at the batch page waiting for the retard to end, so
    // there is no in-app alert for the notification to duplicate. Suppressing it on
    // focus alone would lose the one ping that matters at 06:45.
    const { listeners, showNotification } = loadSw([FOCUSED_CLIENT]);
    const { event, settle } = pushEvent(BATCH_STAGE);
    listeners.get('push')!(event);
    await settle();
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, opts] = showNotification.mock.calls[0]!;
    expect(opts).toBeDefined();
    expect(title).toBe('Shape into the tin');
    // Per batch AND per stage, so the preheat reminder cannot silently replace the
    // shape reminder eight hours earlier.
    expect(opts!.tag).toBe('batch::batch-1::shape');
    // Re-buzzes, unlike the shopping nudge: a timed call to act, deduped server-side.
    expect(opts!.renotify).toBe(true);
    expect(opts!.data.url).toBe('/#/batches/batch-1');
  });

  it('falls back to BATCH copy, not cook-timer copy, for a batch push with no title', async () => {
    // A batch reminder that lost its stage name must not announce itself as a
    // finished cook timer, which is what a single shared default produced.
    const { listeners, showNotification } = loadSw([]);
    const { event, settle } = pushEvent({ type: 'batch-stage', url: '/#/batches/batch-1' });
    listeners.get('push')!(event);
    await settle();
    expect(showNotification.mock.calls[0]![0]).toBe('A batch stage is due');
  });

  it('falls back to the cook-timer copy on an unparseable payload', async () => {
    const { listeners, showNotification } = loadSw([]);
    const pending: Promise<unknown>[] = [];
    listeners.get('push')!({
      data: {
        json: () => {
          throw new Error('not json');
        },
      },
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    await Promise.all(pending);
    expect(showNotification).toHaveBeenCalledWith('Timer finished', expect.anything());
  });
});

describe('push-sw — notificationclick', () => {
  it('navigates an existing window to an explicit data.url', async () => {
    const navigate = vi.fn(async () => undefined);
    const client: FakeClient = { focus: vi.fn(async () => undefined), navigate };
    const { listeners } = loadSw([client]);
    const { event, settle } = clickEvent({ sessionId: null, url: '/#/shopping/list-1' });
    listeners.get('notificationclick')!(event);
    await settle();
    expect(client.focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/#/shopping/list-1');
  });

  it('still derives the cook page from sessionId when there is no url', async () => {
    const navigate = vi.fn(async () => undefined);
    const client: FakeClient = { focus: vi.fn(async () => undefined), navigate };
    const { listeners } = loadSw([client]);
    const { event, settle } = clickEvent({ sessionId: 'recipe-1_uid-1', url: null });
    listeners.get('notificationclick')!(event);
    await settle();
    expect(navigate).toHaveBeenCalledWith('/#/recipes/recipe-1/cook');
  });

  it('routes a batch reminder by its explicit url, never by slicing an id', async () => {
    const navigate = vi.fn(async () => undefined);
    const client: FakeClient = { focus: vi.fn(async () => undefined), navigate };
    const { listeners } = loadSw([client]);
    const { event, settle } = clickEvent({ sessionId: null, url: '/#/batches/batch-1' });
    listeners.get('notificationclick')!(event);
    await settle();
    expect(navigate).toHaveBeenCalledWith('/#/batches/batch-1');
  });

  it('opens a new window at the deep link when nothing is open', async () => {
    const { listeners, openWindow } = loadSw([]);
    const { event, settle } = clickEvent({ url: '/#/shopping/list-1' });
    listeners.get('notificationclick')!(event);
    await settle();
    expect(openWindow).toHaveBeenCalledWith('/#/shopping/list-1');
  });

  it('opens the app root when the notification carries no route at all', async () => {
    const { listeners, openWindow } = loadSw([]);
    const { event, settle } = clickEvent({});
    listeners.get('notificationclick')!(event);
    await settle();
    expect(openWindow).toHaveBeenCalledWith('/');
  });
});
