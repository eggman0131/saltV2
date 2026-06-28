import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachDistributedSpanProcessor } from '../src/server/attachDistributedProcessor.js';
import { distributedSpanProcessor } from '../src/server/distributedSpanProcessor.js';

// ---------------------------------------------------------------------------
// attachDistributedSpanProcessor: unwraps the Genkit-owned global provider and
// adds the distributed-tracing span processor via addSpanProcessor — gated on
// POSTHOG_API_KEY present and GENKIT_TELEMETRY_SERVER unset (the SAME gate as the
// AI processor), and no-op (never-throw) on any provider shape it doesn't
// recognise. `provider` is injected so the global tracer provider isn't touched.
// ---------------------------------------------------------------------------

const prevKey = process.env['POSTHOG_API_KEY'];
const prevDev = process.env['GENKIT_TELEMETRY_SERVER'];
const prevLocal = process.env['SALT_AI_OTLP_LOCAL'];

beforeEach(() => {
  // Default: shippable config (key present, not local dev).
  process.env['POSTHOG_API_KEY'] = 'phc_test';
  delete process.env['GENKIT_TELEMETRY_SERVER'];
  delete process.env['SALT_AI_OTLP_LOCAL'];
});

afterEach(() => {
  if (prevKey === undefined) delete process.env['POSTHOG_API_KEY'];
  else process.env['POSTHOG_API_KEY'] = prevKey;
  if (prevDev === undefined) delete process.env['GENKIT_TELEMETRY_SERVER'];
  else process.env['GENKIT_TELEMETRY_SERVER'] = prevDev;
  if (prevLocal === undefined) delete process.env['SALT_AI_OTLP_LOCAL'];
  else process.env['SALT_AI_OTLP_LOCAL'] = prevLocal;
});

describe('attachDistributedSpanProcessor', () => {
  it('adds our processor to the proxy delegate (the common case)', () => {
    const addSpanProcessor = vi.fn();
    attachDistributedSpanProcessor({ getDelegate: () => ({ addSpanProcessor }) });
    expect(addSpanProcessor).toHaveBeenCalledTimes(1);
    expect(addSpanProcessor).toHaveBeenCalledWith(distributedSpanProcessor);
  });

  it('falls back to a provider that exposes addSpanProcessor directly', () => {
    const addSpanProcessor = vi.fn();
    attachDistributedSpanProcessor({ addSpanProcessor });
    expect(addSpanProcessor).toHaveBeenCalledWith(distributedSpanProcessor);
  });

  it('no-ops when POSTHOG_API_KEY is absent', () => {
    delete process.env['POSTHOG_API_KEY'];
    const addSpanProcessor = vi.fn();
    attachDistributedSpanProcessor({ getDelegate: () => ({ addSpanProcessor }) });
    expect(addSpanProcessor).not.toHaveBeenCalled();
  });

  it('no-ops under GENKIT_TELEMETRY_SERVER (local dev → Genkit Dev UI only)', () => {
    process.env['GENKIT_TELEMETRY_SERVER'] = 'http://localhost:4033';
    const addSpanProcessor = vi.fn();
    attachDistributedSpanProcessor({ getDelegate: () => ({ addSpanProcessor }) });
    expect(addSpanProcessor).not.toHaveBeenCalled();
  });

  it('SALT_AI_OTLP_LOCAL=1 opts back in under GENKIT_TELEMETRY_SERVER (deliberate local verify)', () => {
    process.env['GENKIT_TELEMETRY_SERVER'] = 'http://localhost:4033';
    process.env['SALT_AI_OTLP_LOCAL'] = '1';
    const addSpanProcessor = vi.fn();
    attachDistributedSpanProcessor({ getDelegate: () => ({ addSpanProcessor }) });
    expect(addSpanProcessor).toHaveBeenCalledWith(distributedSpanProcessor);
  });

  it('no-ops without throwing when the delegate lacks addSpanProcessor (OTel 2.x shape)', () => {
    expect(() => attachDistributedSpanProcessor({ getDelegate: () => ({}) })).not.toThrow();
    expect(() => attachDistributedSpanProcessor({})).not.toThrow();
  });

  it('never throws when unwrapping the provider fails', () => {
    expect(() =>
      attachDistributedSpanProcessor({
        getDelegate: () => {
          throw new Error('boom');
        },
      }),
    ).not.toThrow();
  });
});
