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
  type TextMapSetter,
} from '@opentelemetry/api';
import { activeTraceparent, runWithSuppliedTraceContext } from '../src/server/init.js';

// ─── Read-side trace serializer (issue #362, Phase 2) ─────────────────────────
//
// activeTraceparent() is the read-side counterpart to runWithSuppliedTraceContext:
// it serializes the CURRENTLY-ACTIVE OTel context back to a W3C `traceparent`
// string so a flow body running inside an installed browser-supplied trace can
// stamp that id onto a Firestore doc (canon write-back), letting a downstream
// Firestore trigger continue the SAME trace instead of re-rooting. These tests
// prove the round-trip (supplied id in → same id out) and the
// degrade-to-undefined / never-throw contract (Rule 10).
//
// As with the runWith*TraceContext tests, no @opentelemetry/core dependency is
// taken: a hand-rolled ROUND-TRIP propagator stores the supplied traceparent
// under a context key on extract() and writes it back to the carrier on inject()
// — mirroring how the real W3CTraceContextPropagator both lifts and emits
// `traceparent`, but staying inside @opentelemetry/api.

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

const SUPPLIED_KEY = createContextKey('supplied-traceparent');

// A symmetric propagator: extract() lifts `traceparent` into the context (the
// runWithSuppliedTraceContext side), inject() writes the stored value back onto
// the carrier under `traceparent` (the activeTraceparent side). Together they
// round-trip a supplied id through the active context.
class RoundTripPropagator implements TextMapPropagator {
  inject(ctx: Context, carrier: unknown, setter: TextMapSetter): void {
    const value = ctx.getValue(SUPPLIED_KEY);
    if (typeof value === 'string') setter.set(carrier, 'traceparent', value);
  }
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
  propagation.setGlobalPropagator(new RoundTripPropagator());
  context.setGlobalContextManager(new SyncContextManager());
});

afterEach(() => {
  propagation.disable();
  context.disable();
});

describe('activeTraceparent', () => {
  it('serializes the active context back to the supplied traceparent (round-trip)', () => {
    const supplied = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    let observed: string | undefined;
    runWithSuppliedTraceContext(supplied, () => {
      observed = activeTraceparent();
    });
    // Inside the installed browser-supplied trace, the read-side serializer
    // yields the exact same id — this is the value that gets stamped as
    // traceContext on the canon doc so the icon trigger continues the trace.
    expect(observed).toBe(supplied);
  });

  it('returns undefined when no browser trace is active (root/none context)', () => {
    // ROOT_CONTEXT carries no supplied traceparent → the propagator writes nothing
    // → no field. This is the byte-identical-doc case for canonicalise.
    expect(activeTraceparent()).toBeUndefined();
  });

  it('returns undefined once the supplied context has been restored', () => {
    const supplied = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    runWithSuppliedTraceContext(supplied, () => {
      /* active only inside */
    });
    expect(activeTraceparent()).toBeUndefined();
  });

  it('returns undefined and never throws when the propagator throws (Rule 10)', () => {
    class ThrowingPropagator implements TextMapPropagator {
      inject(): void {
        throw new Error('boom');
      }
      extract(ctx: Context): Context {
        return ctx;
      }
      fields(): string[] {
        return ['traceparent'];
      }
    }
    propagation.setGlobalPropagator(new ThrowingPropagator());

    let result: string | undefined = 'sentinel';
    expect(() => {
      result = activeTraceparent();
    }).not.toThrow();
    expect(result).toBeUndefined();
  });

  it('returns undefined when no global propagator is registered (inert)', () => {
    propagation.disable(); // no-op propagator → inject writes nothing
    expect(activeTraceparent()).toBeUndefined();
  });
});
