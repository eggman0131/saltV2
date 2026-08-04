import { describe, it, expect, vi, beforeEach } from 'vitest';

// Coverage of the /settings device readout (issue #680). The distinction that
// matters: `{ status: 'ok', devices: [] }` is the WARNING state the card renders
// (the convention was not followed), while 'unavailable' means we simply could
// not say. Collapsing them would either hide a real misconfiguration or accuse
// the user of one every time Pushover has a wobble.

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'test-secret' }),
}));

vi.mock('firebase-functions/https', async () => {
  const actual = await vi.importActual<typeof import('firebase-functions/https')>(
    'firebase-functions/https',
  );
  return { ...actual, onCall: (_opts: unknown, handler: unknown) => handler };
});

const mockResolveTargets = vi.fn();
vi.mock('../../src/adapters/pushoverRecipient.js', () => ({
  resolvePushoverTargets: mockResolveTargets,
}));

const mockReport = vi.fn();
vi.mock('../../src/observability/reportServerError.js', () => ({
  reportServerError: mockReport,
}));

const { listPushoverDevices } = await import('../../src/callables/listPushoverDevices.js');
const call = listPushoverDevices as unknown as (req: unknown) => Promise<unknown>;

const AUTHED = { auth: { uid: 'uid-1' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveTargets.mockResolvedValue({ kind: 'send', devices: ['daniel-phone'] });
});

describe('listPushoverDevices', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(call({})).rejects.toThrow(/Sign in required/);
  });

  it('returns the resolved devices', async () => {
    await expect(call(AUTHED)).resolves.toEqual({ status: 'ok', devices: ['daniel-phone'] });
    expect(mockResolveTargets).toHaveBeenCalledWith(expect.anything(), 'uid-1');
  });

  it('returns ok with an empty list when nothing matched — the warning state', async () => {
    mockResolveTargets.mockResolvedValue({ kind: 'no-devices', firstName: 'Daniel' });

    await expect(call(AUTHED)).resolves.toEqual({ status: 'ok', devices: [] });
    // Opening settings is not a delivery failure; only a missed timer is.
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('returns unavailable when suppressed or unresolved', async () => {
    mockResolveTargets.mockResolvedValue({ kind: 'suppressed' });
    await expect(call(AUTHED)).resolves.toEqual({ status: 'unavailable' });

    mockResolveTargets.mockResolvedValue({ kind: 'unresolved', reason: 'network' });
    await expect(call(AUTHED)).resolves.toEqual({ status: 'unavailable' });
  });

  it('degrades the card rather than the page when resolution throws', async () => {
    mockResolveTargets.mockRejectedValue(new Error('unexpected'));

    await expect(call(AUTHED)).resolves.toEqual({ status: 'unavailable' });
    expect(mockReport).toHaveBeenCalledTimes(1);
  });
});
