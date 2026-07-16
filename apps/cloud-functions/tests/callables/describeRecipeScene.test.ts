import { describe, it, expect, vi, beforeEach } from 'vitest';

// The describeRecipeScene callable (issue #522, Phase 3): read the recipe → return
// the art-direction brief. Its defining property is what it does NOT do — it
// persists nothing. The brief goes back to the dialog, still editable, and only
// reaches Firestore if the user commits by pressing Regenerate. That is the
// economics of the feature: revise the words for a fraction of a cent, pay for one
// image once they are right.
//
// The callable is a makeTracedCallable declaration in index.ts (not a file in
// callables/), so this exercises the real composition — the real wire schema
// through the real factory — with the flow mocked at the seam.

const mockFlow = vi.fn(async () => ({ brief: 'A blistered, golden-topped bake.' }));

// Firestore is mocked purely so a stray write would be VISIBLE. Nothing in this
// path should touch it; the assertions below are what hold that line.
const mockSet = vi.fn();
const mockUpdate = vi.fn();
const mockDoc = vi.fn(() => ({ set: mockSet, update: mockUpdate }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
  FieldValue: { delete: () => Symbol('delete') },
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
  HttpsError: FakeHttpsError,
}));

const mockRunWithSupplied = vi.fn((_tp: string, fn: () => unknown) => fn());
const mockRunWithExtracted = vi.fn((_h: unknown, fn: () => unknown) => fn());
const mockFlush = vi.fn(async () => undefined);
vi.mock('@salt/observability/server', () => ({
  runWithSuppliedTraceContext: (tp: string, fn: () => unknown) => mockRunWithSupplied(tp, fn),
  runWithExtractedTraceContext: (h: unknown, fn: () => unknown) => mockRunWithExtracted(h, fn),
  flushServerObservability: () => mockFlush(),
}));

vi.mock('../../src/observability/reportServerError.js', () => ({
  reportFlowError: vi.fn(async () => undefined),
  reportServerError: vi.fn(),
}));

const { makeTracedCallable } = await import('../../src/tracedCallable.js');
const { DescribeRecipeSceneWireInputSchema } = await import('@salt/domain/schemas');

// Declared exactly as index.ts declares it.
const describeRecipeScene = makeTracedCallable({
  wireSchema: DescribeRecipeSceneWireInputSchema,
  flow: mockFlow as unknown as (input: never) => unknown,
  options: {},
});

const RECIPE = {
  title: 'Melanzane alla parmigiana',
  description: 'A baked aubergine dish.',
  ingredients: ['2 aubergines, sliced'],
  steps: ['Grill until blistered.'],
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['GENKIT_TELEMETRY_SERVER'];
});

describe('describeRecipeScene callable', () => {
  it('rejects unauthenticated callers — the AI cost is gated on auth', async () => {
    await expect(
      (describeRecipeScene as Function)({ auth: null, data: RECIPE }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockFlow).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload with invalid-argument', async () => {
    await expect(
      (describeRecipeScene as Function)({ auth: { uid: 'u1' }, data: { title: 42 } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockFlow).not.toHaveBeenCalled();
  });

  it('signed-in members may call it — there is NO admin gate', async () => {
    // Recipes are member-writable by design: the gate is on AI cost, not authority.
    const result = await (describeRecipeScene as Function)({
      auth: { uid: 'u1', token: { admin: false } },
      data: RECIPE,
    });
    expect(result).toEqual({ brief: 'A blistered, golden-topped bake.' });
  });

  it('PERSISTS NOTHING — returns the brief without touching Firestore', async () => {
    await (describeRecipeScene as Function)({
      auth: { uid: 'u1' },
      data: { ...RECIPE, currentBrief: 'An autumnal bake.', hint: 'make it summery' },
    });

    // The whole point: a revision costs a fraction of a cent and mutates no doc, so
    // the user can iterate freely and only commit when they press Regenerate. A
    // revision that auto-saved would also silently overwrite the brief behind the
    // image currently on screen.
    expect(mockCollection).not.toHaveBeenCalled();
    expect(mockDoc).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('passes the revision inputs through to the flow', async () => {
    await (describeRecipeScene as Function)({
      auth: { uid: 'u1' },
      data: { ...RECIPE, currentBrief: 'An autumnal bake.', hint: 'make it summery' },
    });

    expect(mockFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Melanzane alla parmigiana',
        currentBrief: 'An autumnal bake.',
        hint: 'make it summery',
      }),
    );
  });

  it('strips traceparent so the flow receives the PURE domain input (domain purity)', async () => {
    await (describeRecipeScene as Function)({
      auth: { uid: 'u1' },
      data: { ...RECIPE, traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01' },
    });

    expect(mockFlow).toHaveBeenCalledTimes(1);
    expect(mockFlow.mock.calls[0]![0]).not.toHaveProperty('traceparent');
    // The browser-supplied field wins over the inbound header.
    expect(mockRunWithSupplied).toHaveBeenCalledWith(
      '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      expect.any(Function),
    );
  });

  it('flushes spans on the happy path (onCall has no framework auto-flush)', async () => {
    await (describeRecipeScene as Function)({ auth: { uid: 'u1' }, data: RECIPE });
    expect(mockFlush).toHaveBeenCalled();
  });
});
