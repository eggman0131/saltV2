import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Feature flags (issue #831) — the browser-side read web-pwa's cosmetic gate sits
// on. Three behaviours, and the asymmetry between them is the whole design:
//
//   • UNCONFIGURED means UNGATED. Live PostHog is the only thing that can answer
//     "yes", so with no key (the e2e build, every unit test) the honest reading is
//     "nothing is being gated" rather than "everything is off".
//   • Every other failure — a key that was supplied but whose SDK never came up, a
//     throwing SDK, a payload that has not landed — is FALSE. Fail closed. The
//     no-key case and the broken-SDK case both leave `ready` false and must NOT be
//     conflated, which is why there is a `configured` bit as well.
//   • `settled` exists so a route guard can tell "not yet" from "no", and never
//     bounces the flagged user before their answer arrives.
//
// `ready` and `flagsSettled` are module state in src/init.ts, so each case gets a
// fresh copy via resetModules rather than trying to unwind them.
// ---------------------------------------------------------------------------

const { isFeatureEnabled, onFeatureFlags, init } = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  onFeatureFlags: vi.fn(),
  init: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: {
    init,
    onFeatureFlags,
    isFeatureEnabled,
    register: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
  },
}));

// The browser tracer is wired by initObservability and is not what is under test;
// stubbing it keeps the OTel SDK out of this suite entirely.
vi.mock('../src/browserTracer.js', () => ({ initBrowserTracing: vi.fn() }));

type InitModule = typeof import('../src/init.js');

async function freshInit(): Promise<InitModule> {
  vi.resetModules();
  return import('../src/init.js');
}

/** A module whose initObservability has succeeded — i.e. `ready === true`. */
async function initialised(): Promise<InitModule> {
  const mod = await freshInit();
  mod.initObservability('test-key');
  return mod;
}

/**
 * A build that was GIVEN a key but whose posthog.init threw — a misconfig, an ad
 * blocker, a blocked network. Indistinguishable from the no-key case by `ready`
 * alone, and the opposite answer.
 */
async function initFailed(): Promise<InitModule> {
  const mod = await freshInit();
  init.mockImplementationOnce(() => {
    throw new Error('blocked');
  });
  mod.initObservability('test-key');
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: PostHog accepts the flag subscription and hands back an unsubscribe.
  onFeatureFlags.mockImplementation(() => () => {});
});

describe('isObservabilityFeatureEnabled', () => {
  it('reports every feature as ON when observability never came up', async () => {
    // The e2e build and every unit test: VITE_PUBLIC_POSTHOG_KEY is empty, so
    // posthog.init is never called. Fail-closed here would switch off half the app
    // in the suites that exist to exercise it, for a gate that is cosmetic anyway.
    const mod = await freshInit();

    expect(mod.isObservabilityFeatureEnabled('bread')).toBe(true);
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('fails closed when a key WAS supplied but the SDK never came up', async () => {
    // The case `ready` alone cannot tell from the one above: PostHog was meant to be
    // here and isn't. That is a failure, and failures fail closed — otherwise an ad
    // blocker would show the whole household a half-built feature.
    const mod = await initFailed();

    expect(mod.isObservabilityFeatureEnabled('bread')).toBe(false);
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('passes the flag key straight through once initialised', async () => {
    const mod = await initialised();
    isFeatureEnabled.mockReturnValue(true);

    expect(mod.isObservabilityFeatureEnabled('bread')).toBe(true);
    expect(isFeatureEnabled).toHaveBeenCalledWith('bread');
  });

  it('reads an undefined answer as OFF, not as on', async () => {
    // posthog.isFeatureEnabled returns `boolean | undefined` — undefined while the
    // payload is still in flight. The `=== true` is what makes that read as off.
    const mod = await initialised();
    isFeatureEnabled.mockReturnValue(undefined);

    expect(mod.isObservabilityFeatureEnabled('bread')).toBe(false);
  });

  it('fails closed when the SDK throws', async () => {
    const mod = await initialised();
    isFeatureEnabled.mockImplementation(() => {
      throw new Error('boom');
    });

    // Never throws across the boundary either (CLAUDE.md Rule 10).
    expect(mod.isObservabilityFeatureEnabled('bread')).toBe(false);
  });
});

describe('areObservabilityFeatureFlagsSettled', () => {
  it('is settled by definition when observability never came up', async () => {
    // There is no payload coming and the answer (ungated) will never change, so a
    // guard that waited here would spin forever.
    const mod = await freshInit();

    expect(mod.areObservabilityFeatureFlagsSettled()).toBe(true);
  });

  it('is settled when a configured SDK failed to come up — off, not spinning', async () => {
    // Fail closed AND settle: no payload is ever coming, so a guard that waited for
    // one would leave the page on a spinner for good.
    const mod = await initFailed();

    expect(mod.areObservabilityFeatureFlagsSettled()).toBe(true);
    expect(mod.isObservabilityFeatureEnabled('bread')).toBe(false);
  });

  it('is UNSETTLED between init and the first flag payload', async () => {
    // The window a route guard must not redirect in — otherwise the flagged user is
    // thrown off their own page a beat before PostHog says they may have it.
    onFeatureFlags.mockImplementation(() => () => {});
    const mod = await initialised();

    expect(mod.areObservabilityFeatureFlagsSettled()).toBe(false);
  });

  it('settles when PostHog delivers a payload', async () => {
    let deliver: (() => void) | null = null;
    onFeatureFlags.mockImplementation((cb: () => void) => {
      deliver = cb;
      return () => {};
    });
    const mod = await initialised();
    expect(mod.areObservabilityFeatureFlagsSettled()).toBe(false);

    deliver!();

    expect(mod.areObservabilityFeatureFlagsSettled()).toBe(true);
  });

  it('settles on a FAILED payload too, leaving every flag off', async () => {
    // PostHog fires the callback even when the load errored (`{ errorsLoading }`).
    // Settled means the answer arrived OR definitively failed — fail closed, but
    // without hanging a route guard on a spinner forever.
    let deliver: (() => void) | null = null;
    onFeatureFlags.mockImplementation((cb: () => void) => {
      deliver = cb;
      return () => {};
    });
    const mod = await initialised();
    isFeatureEnabled.mockReturnValue(undefined); // nothing loaded

    deliver!();

    expect(mod.areObservabilityFeatureFlagsSettled()).toBe(true);
    expect(mod.isObservabilityFeatureEnabled('bread')).toBe(false);
  });
});

describe('onObservabilityFeatureFlags', () => {
  it('hands back PostHog’s own unsubscribe', async () => {
    const unsubscribe = vi.fn();
    const mod = await initialised();
    onFeatureFlags.mockReturnValue(unsubscribe);

    const off = mod.onObservabilityFeatureFlags(() => {});
    off();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('invokes the caller’s callback when a payload lands', async () => {
    const seen = vi.fn();
    let deliver: (() => void) | null = null;
    const mod = await initialised();
    onFeatureFlags.mockImplementation((cb: () => void) => {
      deliver = cb;
      return () => {};
    });

    mod.onObservabilityFeatureFlags(seen);
    deliver!();

    expect(seen).toHaveBeenCalledOnce();
  });

  it('returns a no-op unsubscribe when observability never came up', async () => {
    // Callers need no branch of their own — the returned function is always safe.
    const mod = await freshInit();

    expect(() => mod.onObservabilityFeatureFlags(() => {})()).not.toThrow();
    expect(onFeatureFlags).not.toHaveBeenCalled();
  });

  it('returns a no-op unsubscribe when the SDK throws', async () => {
    const mod = await initialised();
    onFeatureFlags.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => mod.onObservabilityFeatureFlags(() => {})()).not.toThrow();
  });
});
