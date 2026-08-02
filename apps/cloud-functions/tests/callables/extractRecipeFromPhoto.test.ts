import { describe, it, expect, vi, beforeEach } from 'vitest';

// The extractRecipeFromPhoto callable (issue #649, Phase 3) — the REAL export from
// index.ts, with only the flow stubbed, so this exercises the actual composition
// (real wire schema → real traced-callable factory → real onError mapping).
//
// Two things are under test:
//  1. Entrypoint behaviours: auth gate, payload rejection, traceparent stripped
//     so the flow receives pure domain input.
//  2. Selective failure reporting: a photograph too blurry to read, and a page
//     with no recipe on it, are EXPECTED user outcomes and must NOT reach error
//     tracking. Only the recipe reader itself failing is reported.

const mockReport = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);
const mockRunWithSupplied = vi.fn((_tp: string, fn: () => unknown) => fn());

vi.mock('@salt/observability/server', () => ({
  initServerObservability: vi.fn(),
  runWithExtractedTraceContext: vi.fn((_h: unknown, fn: () => unknown) => fn()),
  runWithSuppliedTraceContext: (tp: string, fn: () => unknown) => mockRunWithSupplied(tp, fn),
  attachAiOtlpSpanProcessor: vi.fn(),
  attachDistributedSpanProcessor: vi.fn(),
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: mockReport })),
  flushServerObservability: mockFlush,
}));

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

// The flow under test — stubbed so we drive its outcome from the test. The real
// PhotoImportError shape (code + name) so index.ts's instanceof branch works.
const extractRecipeFromPhotoFlow = vi.fn();
class PhotoImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoImportError';
  }
}
vi.mock('../../src/flows/extractRecipeFromPhoto.js', () => ({
  extractRecipeFromPhotoFlow,
  PhotoImportError,
}));

// Remaining modules index.ts pulls in only to register functions.
vi.mock('../../src/flows/embedText.js', () => ({ embedTextFlow: vi.fn() }));
vi.mock('../../src/flows/arbitrateCanon.js', () => ({ arbitrateCanonFlow: vi.fn() }));
vi.mock('../../src/flows/matchOrCreateCanon.js', () => ({ matchOrCreateCanonFlow: vi.fn() }));
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
vi.mock('../../src/flows/generateChatTitle.js', () => ({ generateChatTitleFlow: vi.fn() }));
vi.mock('../../src/flows/extractRecipeFromUrl.js', () => ({
  extractRecipeFromUrlFlow: vi.fn(),
  UrlImportError: class extends Error {},
}));
vi.mock('../../src/triggers/onShoppingListItemWrite.js', () => ({
  onShoppingListItemWrite: vi.fn(),
}));
vi.mock('../../src/triggers/onCanonItemWritten.js', () => ({ onCanonItemWritten: vi.fn() }));
vi.mock('../../src/ai/listAiModels.js', () => ({ handleListAiModels: vi.fn() }));
vi.mock('../../src/ai/testModel.js', () => ({ handleTestModel: vi.fn() }));
vi.mock('../../src/callables/regenerateCanonIcon.js', () => ({ regenerateCanonIcon: vi.fn() }));
vi.mock('../../src/auth/beforeMemberCreated.js', () => ({ beforeMemberCreated: vi.fn() }));

const { extractRecipeFromPhoto } = await import('../../src/index.js');

const PAGES = { images: [{ base64: 'AAAA', contentType: 'image/webp' }] };
const invoke = (data: unknown, auth: unknown = { uid: 'u1' }) =>
  (extractRecipeFromPhoto as unknown as Function)({ auth, data });

beforeEach(() => {
  vi.clearAllMocks();
  mockFlush.mockResolvedValue(undefined);
  extractRecipeFromPhotoFlow.mockResolvedValue({ id: 'r1', title: 'Ragù' });
  delete process.env['GENKIT_TELEMETRY_SERVER'];
});

describe('extractRecipeFromPhoto callable — entrypoint', () => {
  it('rejects unauthenticated callers — the AI cost is gated on auth', async () => {
    await expect(invoke(PAGES, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(extractRecipeFromPhotoFlow).not.toHaveBeenCalled();
  });

  it('rejects an empty page list with invalid-argument', async () => {
    await expect(invoke({ images: [] })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(extractRecipeFromPhotoFlow).not.toHaveBeenCalled();
  });

  it('rejects more than four pages with invalid-argument', async () => {
    await expect(
      invoke({ images: Array.from({ length: 5 }, () => PAGES.images[0]) }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(extractRecipeFromPhotoFlow).not.toHaveBeenCalled();
  });

  it('rejects an unsupported content type with invalid-argument', async () => {
    await expect(
      invoke({ images: [{ base64: 'AAAA', contentType: 'application/pdf' }] }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('strips traceparent so the flow receives the PURE domain input (domain purity)', async () => {
    const tp = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    await invoke({ ...PAGES, traceparent: tp });

    expect(extractRecipeFromPhotoFlow.mock.calls[0]![0]).not.toHaveProperty('traceparent');
    expect(extractRecipeFromPhotoFlow.mock.calls[0]![0]).toEqual(PAGES);
    // The browser-supplied field wins over the inbound header.
    expect(mockRunWithSupplied).toHaveBeenCalledWith(tp, expect.any(Function));
  });

  it('flushes spans on the happy path (onCall has no framework auto-flush)', async () => {
    await invoke(PAGES);
    expect(mockFlush).toHaveBeenCalled();
  });
});

describe('extractRecipeFromPhoto callable — selective failure reporting', () => {
  it('does NOT report unreadable-photos — an unreadable page is an expected outcome', async () => {
    extractRecipeFromPhotoFlow.mockRejectedValue(
      new PhotoImportError('unreadable-photos', 'nothing readable'),
    );

    await expect(invoke(PAGES)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('reports import-failed — that is the recipe reader breaking, not a bad photo', async () => {
    const boom = new PhotoImportError('import-failed', 'model timed out');
    extractRecipeFromPhotoFlow.mockRejectedValue(boom);

    await expect(invoke(PAGES)).rejects.toMatchObject({ code: 'internal' });
    expect(mockReport).toHaveBeenCalledWith(boom, undefined);
  });

  it('reports an UNEXPECTED (non-PhotoImportError) cause, then maps to HttpsError', async () => {
    const bug = new Error('unexpected null deref in assembleRecipeDraft');
    extractRecipeFromPhotoFlow.mockRejectedValue(bug);

    await expect(invoke(PAGES)).rejects.toBeInstanceOf(FakeHttpsError);
    // The raw cause, never the HttpsError envelope.
    expect(mockReport.mock.calls[0]![0]).toBe(bug);
    expect(mockReport.mock.calls[0]![0]).not.toBeInstanceOf(FakeHttpsError);
  });

  it('does not report on the success path', async () => {
    await invoke(PAGES);
    expect(mockReport).not.toHaveBeenCalled();
  });
});
