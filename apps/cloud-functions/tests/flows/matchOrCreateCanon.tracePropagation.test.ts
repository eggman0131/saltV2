import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Env-gated server-side trace unification at the callable boundary ─────────
//
// Phase 3 makes each CF invocation render as ONE coherent trace: the Genkit
// flow span nests under the platform request span instead of re-rooting a fresh
// trace. The unification is env-gated at the matchOrCreateCanon callable
// entrypoint (apps/cloud-functions/src/index.ts):
//
//   • PRODUCTION (GENKIT_TELEMETRY_SERVER unset): the entrypoint reads the
//     inbound W3C trace headers off request.rawRequest.headers and runs the flow
//     within the extracted context via runWithExtractedTraceContext, so the flow
//     span parents under the request trace.
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
const matchOrCreateCanonFlow = vi.fn(async (_input: unknown) => ({
  kind: 'ok' as const,
  value: { decision: 'matched' as const, item: { name: 'Tomato' } },
}));

vi.mock('@salt/observability/server', () => ({
  initServerObservability: vi.fn(),
  whenServerObservabilityReady: vi.fn(async () => {}),
  runWithExtractedTraceContext,
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

  it('PRODUCTION: tolerates a missing rawRequest (passes undefined headers; helper degrades)', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    const req = { auth: { uid: 'u1' }, data: { rawName: 'tomato' } } as unknown;
    const result = await invoke(req);

    expect(result).toMatchObject({ kind: 'ok' });
    expect(runWithExtractedTraceContext).toHaveBeenCalledOnce();
    const [headersArg] = runWithExtractedTraceContext.mock.calls[0]!;
    expect(headersArg).toBeUndefined();
  });

  it('the _trace wire field is gone: it is not accepted or forwarded as trace plumbing', async () => {
    delete process.env['GENKIT_TELEMETRY_SERVER'];

    // A legacy client that still tacks on _trace must not have it threaded into
    // the flow as a trace-plumbing field; the entrypoint forwards request.data
    // verbatim and the flow's input schema (MatchOrCreateCanonInputSchema) has
    // no _trace, so there is nothing to strip and nothing to forward.
    await invoke(makeRequest({ rawName: 'tomato', _trace: { traceparent } }));

    expect(matchOrCreateCanonFlow).toHaveBeenCalledOnce();
    // The entrypoint does not extract trace context from the payload; the only
    // header source is the request itself.
    const [headersArg] = runWithExtractedTraceContext.mock.calls[0]!;
    expect(headersArg).toEqual({ traceparent });
    // No CallMatchOrCreateOptions / traceHeaders-shaped argument is involved at
    // this boundary.
    const flowArg = matchOrCreateCanonFlow.mock.calls[0]![0] as Record<string, unknown>;
    expect(flowArg).not.toHaveProperty('traceHeaders');
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
