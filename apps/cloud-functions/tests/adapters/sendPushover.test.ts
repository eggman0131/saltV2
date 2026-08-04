import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Coverage of the Pushover adapter (issue #680). The single most important
// property under test is the FAIL-OPEN defence: Pushover broadcasts to every
// device on the account when `device` names something invalid, and this is one
// shared family account, so a zero-match must send NOTHING rather than ping
// everybody for one person's rice.

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { resolvePushoverDevices, sendPushover, __resetPushoverDeviceCache } =
  await import('../../src/adapters/sendPushover.js');

const CREDS = { token: 'app-token', user: 'user-key' };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

// Body of the last fetch call, parsed back out of the form encoding.
function lastFormBody(mock: ReturnType<typeof vi.fn>): URLSearchParams {
  const init = mock.mock.calls.at(-1)![1] as RequestInit;
  return new URLSearchParams(init.body as string);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetPushoverDeviceCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolvePushoverDevices', () => {
  it('returns only the devices matching the member prefix', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 1, devices: ['daniel-phone', 'daniel-tablet', 'claire-phone'] }),
    );

    const devices = await resolvePushoverDevices(CREDS, 'Daniel');

    expect(devices).toEqual(['daniel-phone', 'daniel-tablet']);
  });

  it('requires the hyphen so a shorter name cannot steal a longer one', async () => {
    // Without the trailing '-' in the prefix, 'Dan' would capture every one of
    // Daniel's devices and silently take over their timers.
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 1, devices: ['daniel-phone', 'dan-phone'] }),
    );

    expect(await resolvePushoverDevices(CREDS, 'Dan')).toEqual(['dan-phone']);
  });

  it('returns an empty list (not null) when nothing matches', async () => {
    // [] is the MISCONFIGURATION signal — the account answered fine, the naming
    // convention was simply not followed. The caller reports it.
    fetchMock.mockResolvedValue(jsonResponse({ status: 1, devices: ['claire-phone'] }));

    expect(await resolvePushoverDevices(CREDS, 'Daniel')).toEqual([]);
  });

  it('returns an empty list for a member with no usable name', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 1, devices: ['daniel-phone'] }));

    expect(await resolvePushoverDevices(CREDS, '   ')).toEqual([]);
    // Bails before the round trip — the prefix could never match anything.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null (not []) when the account cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    expect(await resolvePushoverDevices(CREDS, 'Daniel')).toBeNull();
  });

  it('returns null on a rejected request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 0, errors: ['invalid token'] }, false, 400));

    expect(await resolvePushoverDevices(CREDS, 'Daniel')).toBeNull();
  });

  it('returns null when devices is not an array of strings', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 1, devices: [{ name: 'daniel-phone' }] }));

    expect(await resolvePushoverDevices(CREDS, 'Daniel')).toBeNull();
  });

  it('caches the device list across calls', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 1, devices: ['daniel-phone'] }));

    await resolvePushoverDevices(CREDS, 'Daniel');
    await resolvePushoverDevices(CREDS, 'Claire');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed resolution', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    fetchMock.mockResolvedValue(jsonResponse({ status: 1, devices: ['daniel-phone'] }));

    expect(await resolvePushoverDevices(CREDS, 'Daniel')).toBeNull();
    expect(await resolvePushoverDevices(CREDS, 'Daniel')).toEqual(['daniel-phone']);
  });
});

describe('sendPushover', () => {
  it('sends to the named devices at high priority', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 1 }));

    const result = await sendPushover(CREDS, ['daniel-phone', 'daniel-tablet'], {
      title: 'Timer finished',
      body: 'A cook timer just finished.',
    });

    expect(result).toBe('sent');
    const body = lastFormBody(fetchMock);
    expect(body.get('device')).toBe('daniel-phone,daniel-tablet');
    // 1 = high (sound, vibration, bypasses quiet hours). NOT 2 = emergency,
    // which repeats until acknowledged.
    expect(body.get('priority')).toBe('1');
  });

  it('passes a supplementary link through as url + url_title', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 1 }));

    await sendPushover(CREDS, ['daniel-phone'], {
      title: 'Simmer the sauce',
      body: "Shepherd's pie",
      url: 'https://s2-prod-e46bd.web.app/#/recipes/recipe-1/cook',
      urlTitle: 'Back to the cook',
    });

    const body = lastFormBody(fetchMock);
    expect(body.get('url')).toBe('https://s2-prod-e46bd.web.app/#/recipes/recipe-1/cook');
    expect(body.get('url_title')).toBe('Back to the cook');
  });

  it('omits both link params entirely when there is no url', async () => {
    // Not sent-as-empty: Pushover treats a present-but-blank url_title as "use the
    // bare URL as the link text", which is a worse notification than no link.
    fetchMock.mockResolvedValue(jsonResponse({ status: 1 }));

    await sendPushover(CREDS, ['daniel-phone'], { title: 't', body: 'b', urlTitle: 'orphaned' });

    const body = lastFormBody(fetchMock);
    expect(body.has('url')).toBe(false);
    expect(body.has('url_title')).toBe(false);
  });

  it('refuses to send with an empty device list', async () => {
    // The second line of defence against the fail-open broadcast: omitting
    // `device` entirely would ping the whole family.
    const result = await sendPushover(CREDS, [], { title: 't', body: 'b' });

    expect(result).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports failed rather than throwing when the API rejects', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 0, errors: ['bad'] }, false, 400));

    await expect(sendPushover(CREDS, ['daniel-phone'], { title: 't', body: 'b' })).resolves.toBe(
      'failed',
    );
  });

  it('reports failed rather than throwing when the transport dies', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await expect(sendPushover(CREDS, ['daniel-phone'], { title: 't', body: 'b' })).resolves.toBe(
      'failed',
    );
  });
});
