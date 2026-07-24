import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// firebase-sync writes are mocked so we assert the doc shape without Firestore.
const { mockSave, mockDelete } = vi.hoisted(() => ({
  mockSave: vi.fn(async () => ({ kind: 'ok', value: undefined })),
  mockDelete: vi.fn(async () => ({ kind: 'ok', value: undefined })),
}));
vi.mock('@salt/firebase-sync', () => ({
  savePushSubscription: mockSave,
  deletePushSubscription: mockDelete,
}));

const ENDPOINT = 'https://push.example.com/abc123';
const SUB = {
  endpoint: ENDPOINT,
  toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'PK', auth: 'AK' } }),
  unsubscribe: vi.fn(async () => true),
};

let currentSub: typeof SUB | null = null;
const pushManager = {
  getSubscription: vi.fn(async () => currentSub),
  subscribe: vi.fn(async () => {
    currentSub = SUB;
    return SUB;
  }),
};

type NotificationStub = {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
};

function stubBrowser(permission: NotificationPermission, grant: NotificationPermission): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  (window as unknown as { PushManager: unknown }).PushManager = function () {};
  const N: NotificationStub = { permission, requestPermission: vi.fn(async () => grant) };
  (window as unknown as { Notification: unknown }).Notification = N;
  (globalThis as unknown as { Notification: unknown }).Notification = N;
}

async function freshPush() {
  vi.resetModules();
  return (await import('../src/lib/push.svelte.js')).push;
}

beforeEach(() => {
  currentSub = null;
  vi.clearAllMocks();
  mockSave.mockResolvedValue({ kind: 'ok', value: undefined });
  mockDelete.mockResolvedValue({ kind: 'ok', value: undefined });
});

afterEach(() => {
  // Remove the browser stubs so other suites see a clean jsdom.
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(window, 'PushManager');
  Reflect.deleteProperty(window, 'Notification');
  Reflect.deleteProperty(globalThis, 'Notification');
});

describe('push store (#544)', () => {
  it('reports supported + configured when the browser can push and a VAPID key is set', async () => {
    stubBrowser('default', 'granted');
    const push = await freshPush();
    expect(push.supported).toBe(true);
    expect(push.configured).toBe(true);
  });

  it('enable(): requests permission, subscribes, and persists a per-device doc', async () => {
    stubBrowser('default', 'granted');
    const push = await freshPush();

    const ok = await push.enable('user-1');
    expect(ok).toBe(true);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledTimes(1);

    const doc = mockSave.mock.calls[0]![0] as {
      id: string;
      ownerUid: string;
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };
    expect(doc.ownerUid).toBe('user-1');
    expect(doc.endpoint).toBe(ENDPOINT);
    expect(doc.keys).toEqual({ p256dh: 'PK', auth: 'AK' });
    expect(doc.id.startsWith('user-1_')).toBe(true); // `${uid}_${deviceHash}`
    expect(push.enabled).toBe(true);
  });

  it('enable(): a denied permission does not subscribe or persist', async () => {
    stubBrowser('default', 'denied');
    const push = await freshPush();

    const ok = await push.enable('user-1');
    expect(ok).toBe(false);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(push.permissionDenied).toBe(true);
  });

  it('disable(): unsubscribes the browser and deletes the device doc', async () => {
    stubBrowser('granted', 'granted');
    currentSub = SUB; // already subscribed on this device
    const push = await freshPush();

    await push.disable('user-1');
    expect(SUB.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete.mock.calls[0]![0]).toMatch(/^user-1_/);
    expect(push.enabled).toBe(false);
  });
});
