// ── Observability project test setup — drain the tracer's lazy load (#977) ────
//
// `initObservability(key)` calls the browser tracer facade, which loads its
// OpenTelemetry implementation with a FIRE-AND-FORGET `import()` (issue #813 —
// awaiting it would put ~58 kB of SDK in front of first paint). Seven test files
// in this project call `initObservability('test-key')` for reasons that have
// nothing to do with tracing, and each one leaves that import in flight.
//
// A browser can afford that; a Vitest worker cannot. Whether the chunk finishes
// evaluating before or after the worker takes its V8 coverage snapshot is a race
// decided by how long the Vite transform takes — i.e. by whether the transform
// cache is warm. Lose the race and V8 reports `browserTracerImpl.ts` a SECOND
// time with every count at zero; merging that entry into the real one misaligns
// the statement maps, and the report then credits lines that cannot have run
// (the `pagehide` registration, in this project's `node` environment where
// `window` is undefined) while dropping lines that certainly did.
//
// So: after every test, wait for the load to settle. The import below is
// deliberately dynamic and inside the hook — it resolves against the CURRENT
// module registry, so it still finds the right facade instance in the one test
// file here that calls `vi.resetModules()`. A test file that replaces the whole
// facade with `vi.mock` must stub this export as a resolved promise — a stubbed
// facade never starts a load, so there is nothing to drain (featureFlags.test.ts
// is the one file that does this, and Vitest names the missing export loudly if
// a future one forgets).
import { afterEach } from 'vitest';

afterEach(async () => {
  const { browserTracingLoadSettled } = await import('../src/browserTracer.js');
  await browserTracingLoadSettled();
});
