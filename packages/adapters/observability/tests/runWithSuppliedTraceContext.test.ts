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
import { runWithSuppliedTraceContext } from '../src/server/init.js';

// ─── Browser→CF field channel (issue #362, Phase 3) ───────────────────────────
//
// runWithSuppliedTraceContext installs the trace context carried by a SUPPLIED
// `traceparent` STRING (rather than an inbound request header), because the
// Firebase callable SDK cannot carry a custom `traceparent` HTTP header — so a
// browser-minted trace id arrives as a named, typed field on the callable wire
// input, and the CF entrypoint hands that string here. These tests prove the
// supplied id is installed as the active context for the duration of `fn`.

// A minimal synchronous ContextManager so context.with() actually makes the
// passed context active inside the callback (@opentelemetry/api ships only a
// no-op manager whose active() always returns ROOT_CONTEXT). Mirrors the harness
// in runWithExtractedTraceContext.test.ts.
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

// A minimal propagator that lifts the `traceparent` header — the exact key the
// helper synthesizes its carrier under ({ traceparent }) — into the OTel context
// under a known key. Mirrors how the real W3CTraceContextPropagator (installed
// by enableFirebaseTelemetry in production) lifts `traceparent` into a remote
// span context.
const SUPPLIED_KEY = createContextKey('supplied-traceparent');

class TraceparentPropagator implements TextMapPropagator {
  inject(): void {}
  extract(ctx: Context, carrier: unknown, getter: TextMapGetter): Context {
    const value = getter.get(carrier, 'traceparent');
    const header = Array.isArray(value) ? value[0] : value;
    if (typeof header !== 'string') return ctx;
    return ctx.setValue(SUPPLIED_KEY, header);
  }
  fields(): string[] {
    return ['traceparent'];
  }
}

beforeEach(() => {
  propagation.setGlobalPropagator(new TraceparentPropagator());
  context.setGlobalContextManager(new SyncContextManager());
});

afterEach(() => {
  propagation.disable();
  context.disable();
});

describe('runWithSuppliedTraceContext', () => {
  it('runs fn within the context carried by the SUPPLIED traceparent (the flow runs under that trace id)', () => {
    const supplied = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    let activeInsideFn: unknown;
    const result = runWithSuppliedTraceContext(supplied, () => {
      activeInsideFn = context.active().getValue(SUPPLIED_KEY);
      return 'ok';
    });

    expect(result).toBe('ok');
    // The supplied id was lifted into the active context the flow runs within —
    // i.e. the flow's spans nest under that supplied trace, not a fresh root.
    expect(activeInsideFn).toBe(supplied);
    // Context is restored afterwards.
    expect(context.active().getValue(SUPPLIED_KEY)).toBeUndefined();
  });

  it('runs fn plainly (no installed context) when traceparent is undefined', () => {
    let activeInsideFn: unknown = 'sentinel';
    const result = runWithSuppliedTraceContext(undefined, () => {
      activeInsideFn = context.active().getValue(SUPPLIED_KEY);
      return 42;
    });
    expect(result).toBe(42);
    expect(activeInsideFn).toBeUndefined();
  });

  it('runs fn plainly when traceparent is the empty string', () => {
    const result = runWithSuppliedTraceContext('', () => 'plain');
    expect(result).toBe('plain');
  });

  it('never throws if the propagator throws; fn still runs (best-effort, Rule 10)', () => {
    class ThrowingPropagator implements TextMapPropagator {
      inject(): void {}
      extract(): Context {
        throw new Error('boom');
      }
      fields(): string[] {
        return ['traceparent'];
      }
    }
    propagation.setGlobalPropagator(new ThrowingPropagator());

    let ran = false;
    const result = runWithSuppliedTraceContext('00-abc-def-01', () => {
      ran = true;
      return 'safe';
    });
    expect(ran).toBe(true);
    expect(result).toBe('safe');
  });

  it('threads an async fn return promise straight back (the CF entrypoint awaits it)', () => {
    const p = runWithSuppliedTraceContext('00-abc-def-01', async () => 'async-ok');
    expect(p).toBeInstanceOf(Promise);
    return expect(p).resolves.toBe('async-ok');
  });
});
