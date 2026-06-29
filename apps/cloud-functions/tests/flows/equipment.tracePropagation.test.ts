import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Add-equipment one-trace grouping at the callable boundary (issue #361) ───
//
// The add-equipment action fires TWO callables — identifyEquipment then
// populateEquipmentEntry — with human think-time between (the user picks a
// candidate). The browser mints ONE trace id and supplies the SAME `traceparent`
// to both, so both flows install that one context and nest under a single trace
// instead of re-rooting two. These tests import the real callables from index.ts
// (with onCall stubbed to return the bare handler) and assert the same env-gated
// field→header precedence the canon-matching callables use:
//
//   • PRODUCTION (GENKIT_TELEMETRY_SERVER unset): the browser-supplied
//     `traceparent` field WINS (runWithSuppliedTraceContext); the inbound GCP
//     header is the FALLBACK (runWithExtractedTraceContext) only when no field
//     is present. `traceparent` is stripped so the flow gets the PURE domain
//     input (domain purity).
//   • LOCAL DEV (GENKIT_TELEMETRY_SERVER set, by `pnpm dev:emulators`):
//     propagation is SUPPRESSED so each flow stays root-listed in the Dev UI.
//
// The #361 guarantee is the cross-call one: given the SAME supplied traceparent,
// BOTH entrypoints propagate THAT id — so the two legs share one trace.

const runWithExtractedTraceContext = vi.fn(
  (_headers: unknown, fn: () => unknown) => fn() as unknown,
);
const runWithSuppliedTraceContext = vi.fn(
  (_traceparent: unknown, fn: () => unknown) => fn() as unknown,
);
const identifyEquipmentFlow = vi.fn(async (_input: unknown) => ({ candidates: [] }));
const populateEquipmentEntryFlow = vi.fn(async (_input: unknown) => ({
  name: 'Stand mixer',
  accessories: [],
}));
const reportFlowError = vi.fn(async () => {});

vi.mock('@salt/observability/server', () => ({
  initServerObservability: vi.fn(),
  whenServerObservabilityReady: vi.fn(async () => {}),
  runWithExtractedTraceContext,
  runWithSuppliedTraceContext,
  attachAiOtlpSpanProcessor: vi.fn(),
  attachDistributedSpanProcessor: vi.fn(),
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
  flushServerObservability: vi.fn().mockResolvedValue(undefined),
}));

// reportServerError is constructed at index.ts module load; stub it so the
// entrypoint catch is observable and module load is inert.
vi.mock('../../src/observability/reportServerError.js', () => ({ reportFlowError }));

vi.mock('../../src/flows/identifyEquipment.js', () => ({ identifyEquipmentFlow }));
vi.mock('../../src/flows/populateEquipmentEntry.js', () => ({ populateEquipmentEntryFlow }));

// ─── Stub everything else index.ts imports so module load is cheap & inert ────

class FakeHttpsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

vi.mock('firebase-functions/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  onCallGenkit: (_opts: unknown, _flow: unknown) => () => undefined,
  isSignedIn: () => ({}),
  HttpsError: FakeHttpsError,
}));

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));
vi.mock('firebase-functions/v2', () => ({ setGlobalOptions: vi.fn() }));
vi.mock('firebase-functions/params', () => ({ defineSecret: (name: string) => ({ name }) }));
vi.mock('@genkit-ai/firebase', () => ({ enableFirebaseTelemetry: vi.fn(async () => {}) }));
vi.mock('../../src/genkitTracing.js', () => ({ registerGenkitDevTracing: vi.fn() }));

vi.mock('../../src/flows/embedText.js', () => ({ embedTextFlow: vi.fn() }));
vi.mock('../../src/flows/arbitrateCanon.js', () => ({ arbitrateCanonFlow: vi.fn() }));
vi.mock('../../src/flows/matchOrCreateCanon.js', () => ({ matchOrCreateCanonFlow: vi.fn() }));
vi.mock('../../src/flows/canonicaliseRecipeIngredients.js', () => ({
  canonicaliseRecipeIngredientsFlow: vi.fn(),
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

const { identifyEquipment, populateEquipmentEntry } = await import('../../src/index.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

function makeRequest(data: Record<string, unknown>, headers: Record<string, string> = {}) {
  return { auth: { uid: 'u1' }, data, rawRequest: { headers } } as unknown;
}

const callIdentify = (req: unknown) => (identifyEquipment as unknown as Function)(req);
const callPopulate = (req: unknown) => (populateEquipmentEntry as unknown as Function)(req);

const ORIGINAL_GENKIT_ENV = process.env['GENKIT_TELEMETRY_SERVER'];

beforeEach(() => {
  runWithExtractedTraceContext.mockClear();
  runWithSuppliedTraceContext.mockClear();
  identifyEquipmentFlow.mockClear();
  populateEquipmentEntryFlow.mockClear();
  reportFlowError.mockClear();
  delete process.env['GENKIT_TELEMETRY_SERVER'];
});

afterEach(() => {
  if (ORIGINAL_GENKIT_ENV === undefined) delete process.env['GENKIT_TELEMETRY_SERVER'];
  else process.env['GENKIT_TELEMETRY_SERVER'] = ORIGINAL_GENKIT_ENV;
});

// ─── identifyEquipment ────────────────────────────────────────────────────────

describe('identifyEquipment — env-gated trace propagation', () => {
  it('PRODUCTION: a supplied `traceparent` field WINS over an inbound header and is stripped from the flow input', async () => {
    const fieldValue = '00-11111111111111111111111111111111-2222222222222222-01';
    const result = await callIdentify(
      makeRequest({ rawName: 'KitchenAid', traceparent: fieldValue }, { traceparent }),
    );

    expect(result).toMatchObject({ candidates: [] });
    expect(runWithSuppliedTraceContext).toHaveBeenCalledOnce();
    expect(runWithExtractedTraceContext).not.toHaveBeenCalled();
    expect(runWithSuppliedTraceContext.mock.calls[0]![0]).toBe(fieldValue);
    // Domain purity — the flow never sees `traceparent`.
    expect(identifyEquipmentFlow).toHaveBeenCalledWith({ rawName: 'KitchenAid' });
  });

  it('PRODUCTION: with no field, falls back to the inbound header', async () => {
    const result = await callIdentify(makeRequest({ rawName: 'KitchenAid' }, { traceparent }));

    expect(result).toMatchObject({ candidates: [] });
    expect(runWithSuppliedTraceContext).not.toHaveBeenCalled();
    expect(runWithExtractedTraceContext).toHaveBeenCalledOnce();
    expect(runWithExtractedTraceContext.mock.calls[0]![0]).toEqual({ traceparent });
    expect(identifyEquipmentFlow).toHaveBeenCalledWith({ rawName: 'KitchenAid' });
  });

  it('LOCAL DEV: GENKIT_TELEMETRY_SERVER set suppresses propagation (flow stays root)', async () => {
    process.env['GENKIT_TELEMETRY_SERVER'] = 'http://localhost:4033';

    await callIdentify(makeRequest({ rawName: 'KitchenAid', traceparent }, { traceparent }));

    expect(runWithSuppliedTraceContext).not.toHaveBeenCalled();
    expect(runWithExtractedTraceContext).not.toHaveBeenCalled();
    expect(identifyEquipmentFlow).toHaveBeenCalledWith({ rawName: 'KitchenAid' });
  });

  it('rejects an unauthenticated request', async () => {
    await expect(callIdentify({ data: { rawName: 'KitchenAid' } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(identifyEquipmentFlow).not.toHaveBeenCalled();
  });

  it('rejects a malformed wire envelope with invalid-argument', async () => {
    await expect(callIdentify(makeRequest({ rawName: 123 }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(identifyEquipmentFlow).not.toHaveBeenCalled();
  });

  it('reports a flow failure at the entrypoint catch and re-throws', async () => {
    const boom = new Error('model exploded');
    identifyEquipmentFlow.mockRejectedValueOnce(boom);

    await expect(callIdentify(makeRequest({ rawName: 'KitchenAid' }))).rejects.toBe(boom);
    expect(reportFlowError).toHaveBeenCalledWith(boom);
  });
});

// ─── populateEquipmentEntry ───────────────────────────────────────────────────

describe('populateEquipmentEntry — env-gated trace propagation', () => {
  it('PRODUCTION: a supplied `traceparent` field WINS over an inbound header and is stripped from the flow input', async () => {
    const fieldValue = '00-33333333333333333333333333333333-4444444444444444-01';
    const result = await callPopulate(
      makeRequest(
        { confirmedName: 'KitchenAid Artisan', traceparent: fieldValue },
        { traceparent },
      ),
    );

    expect(result).toMatchObject({ name: 'Stand mixer' });
    expect(runWithSuppliedTraceContext).toHaveBeenCalledOnce();
    expect(runWithExtractedTraceContext).not.toHaveBeenCalled();
    expect(runWithSuppliedTraceContext.mock.calls[0]![0]).toBe(fieldValue);
    expect(populateEquipmentEntryFlow).toHaveBeenCalledWith({
      confirmedName: 'KitchenAid Artisan',
    });
  });

  it('LOCAL DEV: GENKIT_TELEMETRY_SERVER set suppresses propagation', async () => {
    process.env['GENKIT_TELEMETRY_SERVER'] = 'http://localhost:4033';

    await callPopulate(makeRequest({ confirmedName: 'KitchenAid Artisan', traceparent }));

    expect(runWithSuppliedTraceContext).not.toHaveBeenCalled();
    expect(runWithExtractedTraceContext).not.toHaveBeenCalled();
    expect(populateEquipmentEntryFlow).toHaveBeenCalledWith({
      confirmedName: 'KitchenAid Artisan',
    });
  });

  it('rejects an unauthenticated request', async () => {
    await expect(callPopulate({ data: { confirmedName: 'x' } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects a malformed wire envelope with invalid-argument', async () => {
    await expect(callPopulate(makeRequest({ confirmedName: 42 }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(populateEquipmentEntryFlow).not.toHaveBeenCalled();
  });
});

// ─── The #361 cross-call guarantee ────────────────────────────────────────────

describe('add-equipment grouping (issue #361)', () => {
  it('both callables propagate the SAME supplied traceparent, so the two flows share one trace', async () => {
    const shared = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

    // Leg 1: identify, supplied with the browser-minted shared trace id.
    await callIdentify(makeRequest({ rawName: 'KitchenAid', traceparent: shared }));
    // Leg 2: populate, supplied with the SAME id after the user picked a candidate.
    await callPopulate(makeRequest({ confirmedName: 'KitchenAid Artisan', traceparent: shared }));

    // Both legs installed the SAME supplied context — one trace across the action.
    expect(runWithSuppliedTraceContext).toHaveBeenCalledTimes(2);
    expect(runWithSuppliedTraceContext.mock.calls[0]![0]).toBe(shared);
    expect(runWithSuppliedTraceContext.mock.calls[1]![0]).toBe(shared);
    expect(runWithExtractedTraceContext).not.toHaveBeenCalled();
  });
});
