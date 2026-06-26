import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  context,
  propagation,
  createContextKey,
  ROOT_CONTEXT,
  type Context,
  type ContextManager,
  type TextMapGetter,
  type TextMapPropagator,
} from '@opentelemetry/api';
import { runWithExtractedTraceContext } from '../src/server/init.js';

// A minimal synchronous ContextManager so context.with() actually makes the
// passed context active inside the callback. @opentelemetry/api ships only a
// no-op manager (active() always returns ROOT_CONTEXT); in production
// enableFirebaseTelemetry() registers a real AsyncLocalStorage-backed one. This
// stack-based stand-in is enough to assert that runWithExtractedTraceContext
// installs the extracted context for the duration of fn.
class SyncContextManager implements ContextManager {
  private stack: Context[] = [ROOT_CONTEXT];
  active(): Context {
    return this.stack[this.stack.length - 1]!;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    this.stack.push(ctx);
    try {
      return fn.call(thisArg as ThisParameterType<F>, ...args);
    } finally {
      this.stack.pop();
    }
  }
  bind<T>(_ctx: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    this.stack = [ROOT_CONTEXT];
    return this;
  }
}

// A minimal TextMapPropagator that lifts a single `x-test-trace` header into the
// OTel context under a known key. Exercised only by these tests — kept inside
// @opentelemetry/api so the package takes no new dependency. Mirrors how the
// real W3CTraceContextPropagator (installed by enableFirebaseTelemetry in
// production) lifts `traceparent` into a remote span context.
const TEST_KEY = createContextKey('x-test-trace');
const HEADER = 'x-test-trace';

class TestPropagator implements TextMapPropagator {
  inject(): void {}
  extract(ctx: Context, carrier: unknown, getter: TextMapGetter): Context {
    const value = getter.get(carrier, HEADER);
    const header = Array.isArray(value) ? value[0] : value;
    if (typeof header !== 'string') return ctx;
    return ctx.setValue(TEST_KEY, header);
  }
  fields(): string[] {
    return [HEADER];
  }
}

beforeEach(() => {
  propagation.setGlobalPropagator(new TestPropagator());
  context.setGlobalContextManager(new SyncContextManager());
});

afterEach(() => {
  propagation.disable();
  context.disable();
});

describe('runWithExtractedTraceContext', () => {
  it('runs fn within the context extracted from the inbound headers', () => {
    let activeInsideFn: unknown;
    const result = runWithExtractedTraceContext({ [HEADER]: 'trace-abc' }, () => {
      activeInsideFn = context.active().getValue(TEST_KEY);
      return 'ok';
    });

    expect(result).toBe('ok');
    // The header value was lifted into the active context the flow runs within.
    expect(activeInsideFn).toBe('trace-abc');
    // Context is restored afterwards.
    expect(context.active().getValue(TEST_KEY)).toBeUndefined();
  });

  it('returns the fn result and forwards no context when headers are undefined', () => {
    const result = runWithExtractedTraceContext(undefined, () => {
      expect(context.active().getValue(TEST_KEY)).toBeUndefined();
      return 42;
    });
    expect(result).toBe(42);
  });

  it('runs fn plainly when headers are an empty object', () => {
    const result = runWithExtractedTraceContext({}, () => 'plain');
    expect(result).toBe('plain');
  });

  it('degrades to a plain fn() call when no global propagator is registered', () => {
    propagation.disable(); // no propagator → extract returns context unchanged
    let ran = false;
    const result = runWithExtractedTraceContext({ [HEADER]: 'trace-abc' }, () => {
      ran = true;
      return 'degraded';
    });
    expect(ran).toBe(true);
    expect(result).toBe('degraded');
  });

  it('never throws even if the propagator throws; fn still runs', () => {
    class ThrowingPropagator implements TextMapPropagator {
      inject(): void {}
      extract(): Context {
        throw new Error('boom');
      }
      fields(): string[] {
        return [HEADER];
      }
    }
    propagation.setGlobalPropagator(new ThrowingPropagator());

    let ran = false;
    const result = runWithExtractedTraceContext({ [HEADER]: 'trace-abc' }, () => {
      ran = true;
      return 'safe';
    });
    expect(ran).toBe(true);
    expect(result).toBe('safe');
  });

  it('propagates the fn return value (sync) for the caller to await', () => {
    // The CF entrypoint calls this with an async fn and awaits the returned
    // promise; assert the promise is threaded straight back.
    const p = runWithExtractedTraceContext({ [HEADER]: 'trace-abc' }, async () => 'async-ok');
    expect(p).toBeInstanceOf(Promise);
    return expect(p).resolves.toBe('async-ok');
  });

  it('does not leak context across a ROOT_CONTEXT baseline', () => {
    // Sanity: outside the helper the active context is the root with no test key.
    expect(context.active()).toBe(ROOT_CONTEXT);
    expect(context.active().getValue(TEST_KEY)).toBeUndefined();
  });
});
