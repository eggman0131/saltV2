import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Server-side feature flags (issue #831) — the read `onBatchWritten` freezes a
// batch reminder's audience with. The server twin of the browser suite in
// featureFlags.test.ts, and the asymmetry it pins is the same one:
//
//   • UNCONFIGURED means UNGATED. With no POSTHOG_API_KEY (an emulator run, every
//     CF unit suite) nothing can answer "yes", so the honest reading is "nothing is
//     being gated" rather than "everything is off" — fail-closed there would
//     silently delete existing coverage.
//   • A key that WAS supplied and whose client never came up is the opposite case,
//     and `client !== null` alone cannot tell the two apart — hence `configured`.
//   • Every other failure — a throwing SDK, a `/flags` timeout, a flag that does
//     not exist — is false, and none of them reach the caller (Rule 10).
//
// `client` and `configured` are module state in src/server/init.ts, so each case
// gets a fresh copy via resetModules rather than trying to unwind them.
// ---------------------------------------------------------------------------

const { getFeatureFlagResult, construct } = vi.hoisted(() => ({
  getFeatureFlagResult: vi.fn(),
  // Lets a test make the PostHog constructor throw — the "configured but broken"
  // case, which is indistinguishable from "no key" by the client alone.
  construct: vi.fn(),
}));

vi.mock('posthog-node', () => {
  // Minimal PostHog stand-in: only what init + the flag read touch.
  class FakePostHog {
    constructor(key: string, opts: unknown) {
      construct(key, opts);
    }
    getFeatureFlagResult(...args: unknown[]): unknown {
      return getFeatureFlagResult(...args);
    }
    capture(): void {}
    async flush(): Promise<void> {}
  }
  return { PostHog: FakePostHog };
});

type ServerInitModule = typeof import('../src/server/init.js');

async function freshInit(): Promise<ServerInitModule> {
  vi.resetModules();
  return import('../src/server/init.js');
}

/** A deployment whose initServerObservability built a live client. */
async function initialised(): Promise<ServerInitModule> {
  const mod = await freshInit();
  mod.initServerObservability('test-key');
  return mod;
}

/** A deployment GIVEN a key whose PostHog constructor threw. */
async function initFailed(): Promise<ServerInitModule> {
  const mod = await freshInit();
  construct.mockImplementationOnce(() => {
    throw new Error('bad config');
  });
  mod.initServerObservability('test-key');
  return mod;
}

const enabled = { key: 'bread', enabled: true, variant: undefined, payload: undefined };
const disabled = { key: 'bread', enabled: false, variant: undefined, payload: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  getFeatureFlagResult.mockResolvedValue(disabled);
});

describe('isServerFeatureEnabled', () => {
  it('reports every feature as ON when no key was supplied', async () => {
    // The emulator and every CF unit suite. Nothing is gated, and nothing is asked.
    const mod = await freshInit();

    await expect(mod.isServerFeatureEnabled('bread', 'uid-1')).resolves.toBe(true);
    expect(getFeatureFlagResult).not.toHaveBeenCalled();
  });

  it('fails closed when a key WAS supplied but the client never came up', async () => {
    // The case `client` alone cannot tell from the one above: PostHog was meant to
    // be here and isn't. That is a failure, and failures fail closed — otherwise a
    // misconfigured deployment would push a half-built feature at the whole house.
    const mod = await initFailed();

    await expect(mod.isServerFeatureEnabled('bread', 'uid-1')).resolves.toBe(false);
    expect(getFeatureFlagResult).not.toHaveBeenCalled();
  });

  it('passes a resolved answer straight through', async () => {
    const mod = await initialised();
    getFeatureFlagResult.mockResolvedValue(enabled);

    await expect(mod.isServerFeatureEnabled('bread', 'uid-1')).resolves.toBe(true);
  });

  it('reads a disabled flag as OFF', async () => {
    const mod = await initialised();

    await expect(mod.isServerFeatureEnabled('bread', 'uid-1')).resolves.toBe(false);
  });

  it('reads an ABSENT flag as OFF, not as on', async () => {
    // undefined = the flag does not exist / was not returned. Off, like every other
    // uncertain answer here.
    const mod = await initialised();
    getFeatureFlagResult.mockResolvedValue(undefined);

    await expect(mod.isServerFeatureEnabled('bread', 'uid-1')).resolves.toBe(false);
  });

  it('asks about ONE flag, for the uid, with the email as a person property', async () => {
    // The browser identifies people by uid with `email` as a person property, so an
    // email-targeted release condition only matches if the server asks the same way.
    // `sendFeatureFlagEvents: false` matters because the caller runs on EVERY batch
    // write and asks once per household member.
    const mod = await initialised();

    await mod.isServerFeatureEnabled('bread', 'uid-1', { email: 'daniel@pendery.org' });

    expect(getFeatureFlagResult).toHaveBeenCalledWith('bread', 'uid-1', {
      personProperties: { email: 'daniel@pendery.org' },
      sendFeatureFlagEvents: false,
    });
  });

  it('fails closed — and does not reject — when the SDK throws', async () => {
    const mod = await initialised();
    getFeatureFlagResult.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(mod.isServerFeatureEnabled('bread', 'uid-1')).resolves.toBe(false);
  });

  it('fails closed when the flag request rejects (a /flags timeout)', async () => {
    // Never throws across the boundary either (CLAUDE.md Rule 10).
    const mod = await initialised();
    getFeatureFlagResult.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(mod.isServerFeatureEnabled('bread', 'uid-1')).resolves.toBe(false);
  });
});
