import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Genkit OTel root-span-detection gate (issue #362) ────────────────────────
//
// genkit.ts disables Genkit's OTel root-span detection at module load so flow
// spans nest under the propagated browser/request trace instead of re-rooting a
// fresh one. By default Genkit marks every top-level flow span `isRoot` and
// passes `{ root: true }` to OTel, which DELETES the active span from the context
// — so the flow ignores the trace we installed via runWith{Extracted,Supplied}
// TraceContext. disableOTelRootSpanDetection() stops that, letting flow spans
// parent off context.active() like any other span.
//
// The toggle is env-gated on the SAME switch as the propagation helpers
// (runFlowWithTraceContext / runTriggerWithTraceContext): honoured in
// prod/staging (GENKIT_TELEMETRY_SERVER unset) so the AI sub-flows join the one
// end-to-end trace; SUPPRESSED in local dev (set by `pnpm dev:emulators`) so
// flows stay root-listed in the Genkit Dev UI. These tests assert that gate by
// re-importing genkit.ts under each env and checking the spy.

const disableOTelRootSpanDetection = vi.fn();

vi.mock('genkit/tracing', () => ({ disableOTelRootSpanDetection }));
// Stub the genkit factory + plugin so importing genkit.ts pulls in no real
// genkit/Gemini machinery — we only exercise the module-load root-span gate.
vi.mock('genkit', () => ({ genkit: vi.fn(() => ({})) }));
vi.mock('@genkit-ai/google-genai', () => ({ googleAI: () => ({}) }));

const ORIGINAL_GENKIT_ENV = process.env['GENKIT_TELEMETRY_SERVER'];

beforeEach(() => {
  // Reset the module registry so each test re-runs genkit.ts's module-load gate
  // under the env it sets; the spy is module-scoped to this file and survives the
  // reset, so clear it explicitly.
  vi.resetModules();
  disableOTelRootSpanDetection.mockClear();
});

afterEach(() => {
  if (ORIGINAL_GENKIT_ENV === undefined) delete process.env['GENKIT_TELEMETRY_SERVER'];
  else process.env['GENKIT_TELEMETRY_SERVER'] = ORIGINAL_GENKIT_ENV;
});

describe('genkit init — OTel root-span-detection gate', () => {
  it('PRODUCTION: disables root-span detection when GENKIT_TELEMETRY_SERVER is unset (flows nest under the propagated trace)', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    await import('../src/genkit.js');

    expect(disableOTelRootSpanDetection).toHaveBeenCalledOnce();
  });

  it('LOCAL DEV: leaves root-span detection ON when GENKIT_TELEMETRY_SERVER is set (flows stay root-listed in the Dev UI)', async () => {
    process.env['GENKIT_TELEMETRY_SERVER'] = 'http://localhost:4033';

    await import('../src/genkit.js');

    expect(disableOTelRootSpanDetection).not.toHaveBeenCalled();
  });
});
