import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression for issue #406: the SSRF guard is fully bypassed for IP-literal
// hosts. Node's net/https layer skips the custom `lookup` callback when the host
// is already an IP literal (`isIP(host)` truthy → direct connect), so the
// resolved-address enforcement in `guardedLookup` never runs. The fix classifies
// IP-literal hosts up-front in `assertUrlAllowed` — for both the initial URL and
// every redirect hop (which re-validates through the same function).
//
// These tests drive the PUBLIC `ssrfGuardedFetch` and mock `node:https` so we
// can prove two things without a network:
//   1. A private/internal IP-literal URL is refused BEFORE any connect
//      (`https.request` is never called).
//   2. A redirect whose Location is a private IP literal is refused.

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

// Inert span so `startSpan` needs no real telemetry init.
vi.mock('@salt/observability/server', () => ({
  startSpan: () => ({ setAttribute() {}, end() {} }),
}));

// `import https from 'node:https'` → https.request === requestMock.
vi.mock('node:https', () => ({ default: { request: requestMock } }));

const { ssrfGuardedFetch, SsrfFetchError } = await import('../../src/adapters/ssrfFetch.js');

// A minimal https.ClientRequest: only `.on()` and `.end()` are used.
const fakeReq = () => ({ on: () => fakeReq(), end() {} });

// A 200 text/html response that ends immediately (empty body is fine here).
const bodyRes = () => ({
  statusCode: 200,
  headers: { 'content-type': 'text/html' },
  resume() {},
  on(event: string, cb: () => void) {
    if (event === 'end') cb();
    return this;
  },
});

// A 3xx redirect pointing at `location`.
const redirectRes = (location: string) => ({
  statusCode: 302,
  headers: { location },
  resume() {},
});

beforeEach(() => {
  requestMock.mockReset();
});

describe('ssrfGuardedFetch — IP-literal SSRF guard (#406)', () => {
  const BLOCKED_LITERALS = [
    'https://10.0.0.5/', // RFC-1918 private (v4)
    'https://127.0.0.1/', // loopback (v4)
    'https://127.0.0.1:8443/', // loopback with port (v4)
    'https://169.254.169.254/', // link-local / cloud metadata (v4)
    'https://[::1]/', // loopback (v6, bracketed)
    'https://[fd00::1]/', // unique-local / ULA (v6, bracketed)
    'https://[fe80::1]/', // link-local (v6, bracketed)
    'https://[::ffff:10.0.0.1]/', // IPv4-mapped private (v6, bracketed)
  ];

  it.each(BLOCKED_LITERALS)('refuses %s before any connect', async (url) => {
    // If the guard failed to block, the request would connect and succeed.
    requestMock.mockImplementation((_u: unknown, _o: unknown, cb: (r: unknown) => void) => {
      queueMicrotask(() => cb(bodyRes()));
      return fakeReq();
    });

    const err = await ssrfGuardedFetch(url).catch((e) => e);
    expect(err).toBeInstanceOf(SsrfFetchError);
    expect(err.reason).toBe('blocked');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://example.com/', // hostname → resolved-address guard handles it at connect
    'https://93.184.216.34/', // public IPv4 literal must NOT be over-blocked
  ])('allows %s through the literal guard to connect', async (url) => {
    requestMock.mockImplementation((_u: unknown, _o: unknown, cb: (r: unknown) => void) => {
      queueMicrotask(() => cb(bodyRes()));
      return fakeReq();
    });

    await expect(ssrfGuardedFetch(url)).resolves.toMatchObject({ finalUrl: url });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect whose target is a private IP literal', async () => {
    // First (and only) connect is the public origin; it 302s to a private literal.
    requestMock.mockImplementation((_u: unknown, _o: unknown, cb: (r: unknown) => void) => {
      queueMicrotask(() => cb(redirectRes('https://10.0.0.5/')));
      return fakeReq();
    });

    const err = await ssrfGuardedFetch('https://example.com/recipe').catch((e) => e);
    expect(err).toBeInstanceOf(SsrfFetchError);
    expect(err.reason).toBe('blocked');
    // The origin was contacted once; the redirect target was refused before connect.
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
