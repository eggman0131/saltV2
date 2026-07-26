import { describe, it, expect, vi, beforeEach } from 'vitest';

// The OTP code-entry step is persisted so it survives the app being torn down
// while the user is off in their email client fetching the code — the iOS
// standalone case, where the OS routinely kills a backgrounded PWA (#585
// follow-up). The store is a module-level singleton that reads storage in its
// constructor, so each test seeds localStorage and re-imports it fresh.

const { mockAuthProvider } = vi.hoisted(() => ({
  mockAuthProvider: {
    getCurrentUser: vi.fn(() => null),
    observe: vi.fn(),
    isMagicLink: vi.fn(() => false),
    requestEmailCode: vi.fn(async () => ({ kind: 'ok' as const, value: undefined })),
    signInWithEmailCode: vi.fn(async () => ({ kind: 'ok' as const, value: undefined })),
  },
}));
vi.mock('../src/lib/firebase.js', () => ({ authProvider: mockAuthProvider, useEmulators: false }));
vi.mock('../src/lib/observability.js', () => ({
  identifyUser: vi.fn(),
  identifyAnonymous: vi.fn(),
}));

const PENDING_OTP_KEY = 'salt:auth:pendingOtp';
const TEN_MINUTES = 10 * 60 * 1000;

async function freshAuth() {
  vi.resetModules();
  return (await import('../src/lib/auth.svelte.js')).auth;
}

function readStoredOtp(): { email: string; sentAt: number } | null {
  const raw = window.localStorage.getItem(PENDING_OTP_KEY);
  return raw === null ? null : (JSON.parse(raw) as { email: string; sentAt: number });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('auth store — OTP step survives an app relaunch (#585 follow-up)', () => {
  it('restores the code-entry step for a code that is still live', async () => {
    window.localStorage.setItem(
      PENDING_OTP_KEY,
      JSON.stringify({ email: 'cook@example.com', sentAt: Date.now() - 60_000 }),
    );
    const auth = await freshAuth();
    expect(auth.codeSent).toBe(true);
    expect(auth.codeEmail).toBe('cook@example.com');
  });

  it('drops a step whose code has outlived the server TTL', async () => {
    window.localStorage.setItem(
      PENDING_OTP_KEY,
      JSON.stringify({ email: 'cook@example.com', sentAt: Date.now() - TEN_MINUTES - 1 }),
    );
    const auth = await freshAuth();
    expect(auth.codeSent).toBe(false);
    expect(auth.codeEmail).toBe('');
    // And it doesn't linger to be re-evaluated on every future launch.
    expect(readStoredOtp()).toBeNull();
  });

  it('ignores a corrupt stored value rather than throwing on boot', async () => {
    window.localStorage.setItem(PENDING_OTP_KEY, 'not-json');
    const auth = await freshAuth();
    expect(auth.codeSent).toBe(false);
  });

  it('ignores a stored value that does not match the schema', async () => {
    window.localStorage.setItem(PENDING_OTP_KEY, JSON.stringify({ email: 'nope', sentAt: 'soon' }));
    const auth = await freshAuth();
    expect(auth.codeSent).toBe(false);
  });

  it('starts on the request step when nothing is stored', async () => {
    const auth = await freshAuth();
    expect(auth.codeSent).toBe(false);
    expect(auth.codeEmail).toBe('');
  });

  it('persists the step (normalised) as soon as a code is requested', async () => {
    const auth = await freshAuth();
    await auth.requestCode('Cook@Example.com ');
    expect(auth.codeSent).toBe(true);
    expect(auth.codeEmail).toBe('cook@example.com');
    expect(readStoredOtp()?.email).toBe('cook@example.com');
  });

  it('persists nothing when the request fails', async () => {
    mockAuthProvider.requestEmailCode.mockResolvedValueOnce({
      kind: 'failure',
      error: { kind: 'NetworkError' },
    } as never);
    const auth = await freshAuth();
    await auth.requestCode('cook@example.com');
    expect(auth.codeSent).toBe(false);
    expect(readStoredOtp()).toBeNull();
  });

  it('clears the stored step once the code signs the user in', async () => {
    const auth = await freshAuth();
    await auth.requestCode('cook@example.com');
    await auth.submitCode('cook@example.com', '123456');
    expect(readStoredOtp()).toBeNull();
    expect(auth.codeSent).toBe(false);
  });

  it('keeps the stored step when the code is rejected, so a retry still works', async () => {
    mockAuthProvider.signInWithEmailCode.mockResolvedValueOnce({
      kind: 'failure',
      error: { kind: 'AuthError', reason: 'expired' },
    } as never);
    const auth = await freshAuth();
    await auth.requestCode('cook@example.com');
    await auth.submitCode('cook@example.com', '000000');
    expect(auth.codeSent).toBe(true);
    expect(readStoredOtp()?.email).toBe('cook@example.com');
    expect(auth.error).toBe('That code is incorrect or has expired. Request a new one.');
  });

  it('clears the stored step when the user chooses a different email', async () => {
    const auth = await freshAuth();
    await auth.requestCode('cook@example.com');
    auth.resetCode();
    expect(auth.codeSent).toBe(false);
    expect(auth.codeEmail).toBe('');
    expect(readStoredOtp()).toBeNull();
  });
});
