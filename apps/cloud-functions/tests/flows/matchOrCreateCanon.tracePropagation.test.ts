import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Env-gated server-side trace unification at the callable boundary ─────────
//
// Phase 3 makes each CF invocation render as ONE coherent trace: the Genkit
// flow span nests under the platform request span instead of re-rooting a fresh
// trace. The unification is env-gated at the matchOrCreateCanon callable
// entrypoint (apps/cloud-functions/src/index.ts):
//
//   • PRODUCTION (GENKIT_TELEMETRY_SERVER unset): for these USER-INITIATED
//     callables the browser-supplied `traceparent` field WINS — the entrypoint
//     runs the flow within that supplied context via runWithSuppliedTraceContext.
//     The field is the only channel that can carry the browser's trace id (the
//     callable SDK can't carry a custom header), so it is what unifies the
//     browser action with the server flow. The inbound W3C trace header off
//     request.rawRequest.headers is GCP's fresh request-trace root and serves as
//     the FALLBACK (runWithExtractedTraceContext) only when no non-empty field
//     is present.
//   • LOCAL DEV (GENKIT_TELEMETRY_SERVER set, by `pnpm dev:emulators`):
//     propagation is SUPPRESSED — the flow runs without any installed parent
//     context so it stays root-listed in the Genkit Dev UI (whose trace list
//     surfaces only flow-rooted traces). This gate is exactly what resolves the
//     2026-05-11 regression that previously parked propagation.
//
// These tests import the real callable from index.ts (with onCall stubbed to
// return the handler) and assert the gate's branch behaviour, plus that the
// vestigial browser→CF `_trace` wire field is gone (no longer accepted or
// forwarded — the flow is invoked with request.data verbatim).

// ─── Capture the runWithExtractedTraceContext + flow calls ────────────────────

const runWithExtractedTraceContext = vi.fn(
  (_headers: unknown, fn: () => unknown) => fn() as unknown,
);
// Field-channel counterpart (issue #362): browser-supplied `traceparent` rides
// the payload (the callable SDK can't carry a custom header), and the entrypoint
// runs the flow within that supplied context when no inbound header is present.
const runWithSuppliedTraceContext = vi.fn(
  (_traceparent: unknown, fn: () => unknown) => fn() as unknown,
);
const matchOrCreateCanonFlow = vi.fn(async (_input: unknown) => ({
  kind: 'ok' as const,
  value: { decision: 'matched' as const, item: { name: 'Tomato' } },
}));

vi.mock('@salt/observability/server', () => ({
  initServerObservability: vi.fn(),
  whenServerObservabilityReady: vi.fn(async () => {}),
  runWithExtractedTraceContext,
  runWithSuppliedTraceContext,
  attachAiOtlpSpanProcessor: vi.fn(),
  attachDistributedSpanProcessor: vi.fn(),
  // index.ts now imports ../observability/reportServerError.js, which constructs
  // the server error reporter at module load and flushes on the report path.
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
  flushServerObservability: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/flows/matchOrCreateCanon.js', () => ({ matchOrCreateCanonFlow }));

// ─── Stub everything else index.ts imports so module load is cheap & inert ────

class FakeHttpsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// onCall returns the bare handler so the test can invoke it directly; the other
// registration helpers return inert callables (the test only exercises
// matchOrCreateCanon).
vi.mock('firebase-functions/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  onCallGenkit: (_opts: unknown, _flow: unknown) => () => undefined,
  isSignedIn: () => ({}),
  HttpsError: FakeHttpsError,
}));

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));
vi.mock('firebase-functions/v2', () => ({ setGlobalOptions: vi.fn() }));
vi.mock('firebase-functions/params', () => ({
  defineSecret: (name: string) => ({ name }),
}));
vi.mock('@genkit-ai/firebase', () => ({
  // Resolves so the module-load `void enableFirebaseTelemetry().catch(...)`
  // is a clean no-op under test.
  enableFirebaseTelemetry: vi.fn(async () => {}),
}));
vi.mock('../../src/genkitTracing.js', () => ({ registerGenkitDevTracing: vi.fn() }));

// The remaining flow/trigger/callable modules are imported by index.ts only to
// register other functions; stub them so loading index.ts pulls in no genkit /
// firestore machinery.
vi.mock('../../src/flows/embedText.js', () => ({ embedTextFlow: vi.fn() }));
vi.mock('../../src/flows/arbitrateCanon.js', () => ({ arbitrateCanonFlow: vi.fn() }));
vi.mock('../../src/flows/canonicaliseRecipeIngredients.js', () => ({
  canonicaliseRecipeIngredientsFlow: vi.fn(),
}));
vi.mock('../../src/flows/identifyEquipment.js', () => ({ identifyEquipmentFlow: vi.fn() }));
vi.mock('../../src/flows/populateEquipmentEntry.js', () => ({
  populateEquipmentEntryFlow: vi.fn(),
}));
vi.mock('../../src/flows/parseRecipeIngredients.js', () => ({
  parseRecipeIngredientsFlow: vi.fn(),
}));
vi.mock('../../src/flows/chefChat.js', () => ({ chefChatFlow: vi.fn() }));
vi.mock('../../src/flows/authorRecipe.js', () => ({ authorRecipeFlow: vi.fn() }));
vi.mock('../../src/flows/extractRecipeFromUrl.js', () => ({
  extractRecipeFromUrlFlow: vi.fn(),
  UrlImportError: class UrlImportError extends Error {},
}));
vi.mock('../../src/flows/generateChatTitle.js', () => ({ generateChatTitleFlow: vi.fn() }));
vi.mock('../../src/triggers/onShoppingListItemWrite.js', () => ({
  onShoppingListItemWrite: vi.fn(),
}));
vi.mock('../../src/triggers/onCanonItemWritten.js', () => ({ onCanonItemWritten: vi.fn() }));
vi.mock('../../src/ai/listAiModels.js', () => ({ handleListAiModels: vi.fn() }));
vi.mock('../../src/ai/testModel.js', () => ({ handleTestModel: vi.fn() }));
vi.mock('../../src/callables/regenerateCanonIcon.js', () => ({ regenerateCanonIcon: vi.fn() }));
vi.mock('../../src/auth/beforeMemberCreated.js', () => ({ beforeMemberCreated: vi.fn() }));

const { matchOrCreateCanon } = await import('../../src/index.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

function makeRequest(
  data: Record<string, unknown>,
  headers: Record<string, string> = { traceparent },
) {
  return {
    auth: { uid: 'u1' },
    data,
    rawRequest: { headers },
  } as unknown;
}

const invoke = (req: unknown) => (matchOrCreateCanon as unknown as Function)(req);

const ORIGINAL_GENKIT_ENV = process.env['GENKIT_TELEMETRY_SERVER'];

beforeEach(() => {
  runWithExtractedTraceContext.mockClear();
  runWithSuppliedTraceContext.mockClear();
  matchOrCreateCanonFlow.mockClear();
});

afterEach(() => {
  if (ORIGINAL_GENKIT_ENV === undefined) delete process.env['GENKIT_TELEMETRY_SERVER'];
  else process.env['GENKIT_TELEMETRY_SERVER'] = ORIGINAL_GENKIT_ENV;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('matchOrCreateCanon — env-gated server-side trace unification', () => {
  it('LOCAL DEV: when GENKIT_TELEMETRY_SERVER is set, does NOT install a propagated context (flow stays root)', async () => {
    process.env['GENKIT_TELEMETRY_SERVER'] = 'http://localhost:4033';

    const result = await invoke(makeRequest({ rawName: 'tomato' }));

    expect(result).toMatchObject({ kind: 'ok' });
    // No propagation: the helper is never invoked, so no parent context is
    // installed and the flow opens a root span the Dev UI can list.
    expect(runWithExtractedTraceContext).not.toHaveBeenCalled();
    expect(matchOrCreateCanonFlow).toHaveBeenCalledOnce();
    expect(matchOrCreateCanonFlow).toHaveBeenCalledWith({ rawName: 'tomato' });
  });

  it('PRODUCTION: when GENKIT_TELEMETRY_SERVER is unset, extracts inbound headers and runs the flow within the propagated context', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    const result = await invoke(makeRequest({ rawName: 'tomato' }, { traceparent }));

    expect(result).toMatchObject({ kind: 'ok' });
    // The entrypoint reads the inbound trace headers off rawRequest and runs the
    // flow within the extracted context, so the flow span nests under the
    // request trace (one coherent trace).
    expect(runWithExtractedTraceContext).toHaveBeenCalledOnce();
    const [headersArg] = runWithExtractedTraceContext.mock.calls[0]!;
    expect(headersArg).toEqual({ traceparent });
    // The flow runs *inside* the propagated context (our mock invokes fn()).
    expect(matchOrCreateCanonFlow).toHaveBeenCalledOnce();
    expect(matchOrCreateCanonFlow).toHaveBeenCalledWith({ rawName: 'tomato' });
  });

  it('PRODUCTION: tolerates a missing rawRequest and no payload traceparent (the header fallback degrades to a plain call)', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    const req = { auth: { uid: 'u1' }, data: { rawName: 'tomato' } } as unknown;
    const result = await invoke(req);

    expect(result).toMatchObject({ kind: 'ok' });
    // No payload `traceparent` field → the supplied path is NOT taken; we fall
    // back to the header path. There is no rawRequest either, so the header
    // fallback runs with an empty header bag and degrades to a plain flow call.
    expect(runWithSuppliedTraceContext).not.toHaveBeenCalled();
    expect(runWithExtractedTraceContext).toHaveBeenCalledOnce();
    const [headersArg] = runWithExtractedTraceContext.mock.calls[0]!;
    expect(headersArg).toEqual({});
    expect(matchOrCreateCanonFlow).toHaveBeenCalledWith({ rawName: 'tomato' });
  });

  it('the magic _trace wire field is still gone: an unknown _trace key is stripped, not threaded into the flow', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    // The named, typed `traceparent` field SUPERSEDES the old magic `_trace`
    // plumbing. A legacy client that still tacks on `_trace` must not have it
    // threaded into the flow: it is not in the wire-envelope schema, so Zod
    // strips it. The inbound header still drives propagation here.
    await invoke(makeRequest({ rawName: 'tomato', _trace: { traceparent } }));

    expect(matchOrCreateCanonFlow).toHaveBeenCalledOnce();
    // The flow receives the PURE domain input — no _trace, no traceparent.
    expect(matchOrCreateCanonFlow).toHaveBeenCalledWith({ rawName: 'tomato' });
    const flowArg = matchOrCreateCanonFlow.mock.calls[0]![0] as Record<string, unknown>;
    expect(flowArg).not.toHaveProperty('_trace');
    expect(flowArg).not.toHaveProperty('traceparent');
    // No real `traceparent` field survives the strip (`_trace` is not the field),
    // so the inbound header drives propagation as the fallback.
    const [headersArg] = runWithExtractedTraceContext.mock.calls[0]!;
    expect(headersArg).toEqual({ traceparent });
  });

  it('PRODUCTION: a browser-supplied payload `traceparent` (no inbound header) propagates via the supplied-context path and is stripped from the flow input', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    // No inbound trace header on the request → fall back to the named, typed
    // `traceparent` field on the WIRE input. The entrypoint strips it and runs
    // the flow within that supplied context (Phase 4 mints a real browser id;
    // here it is synthetic).
    const result = await invoke(makeRequest({ rawName: 'tomato', traceparent }, {}));

    expect(result).toMatchObject({ kind: 'ok' });
    // Header path is NOT used (no usable inbound headers); supplied path is.
    expect(runWithExtractedTraceContext).not.toHaveBeenCalled();
    expect(runWithSuppliedTraceContext).toHaveBeenCalledOnce();
    const [tpArg] = runWithSuppliedTraceContext.mock.calls[0]!;
    expect(tpArg).toBe(traceparent);
    // The flow gets the PURE domain input — traceparent stripped (domain purity).
    expect(matchOrCreateCanonFlow).toHaveBeenCalledWith({ rawName: 'tomato' });
  });

  it('PRODUCTION: a payload `traceparent` field WINS over an inbound header (field > header precedence)', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    // Both channels carry a trace: a browser-supplied field AND an inbound GCP
    // header. The field WINS — it is the only channel that can carry the browser
    // trace id, so it is what unifies the browser action with the server flow.
    // The inbound header (GCP's fresh request-trace root) is not consulted.
    const fieldValue = '00-11111111111111111111111111111111-2222222222222222-01';
    await invoke(makeRequest({ rawName: 'tomato', traceparent: fieldValue }, { traceparent }));

    expect(runWithSuppliedTraceContext).toHaveBeenCalledOnce();
    expect(runWithExtractedTraceContext).not.toHaveBeenCalled();
    const [tpArg] = runWithSuppliedTraceContext.mock.calls[0]!;
    expect(tpArg).toBe(fieldValue);
    expect(matchOrCreateCanonFlow).toHaveBeenCalledWith({ rawName: 'tomato' });
  });

  it('rejects unauthenticated callers before touching propagation', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    await expect(invoke({ auth: null, data: { rawName: 'tomato' } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(runWithExtractedTraceContext).not.toHaveBeenCalled();
    expect(matchOrCreateCanonFlow).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with invalid-argument', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    await expect(invoke(makeRequest({ notRawName: 1 }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(matchOrCreateCanonFlow).not.toHaveBeenCalled();
  });
});
