import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CanonItemDoc } from '@salt/domain/schemas';

// ─── Trace propagation via the traceContext doc field (issue #362, Phase 5) ─────
// Unit-level (mock-based, no emulator): asserts the icon + embedding work runs
// WITHIN the W3C trace context carried by the canon doc's `traceContext`, so the
// onCanonItemWritten side-effects nest under the same browser-rooted trace the
// onShoppingListItemWrite trigger stamped on the canon doc — and that an
// absent/malformed traceContext degrades to a normal root trace without throwing.

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => '' }),
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// AI flows + imaging are stubbed — we only care about the trace wrapping.
const mockEmbed = vi.fn(async () => ({ values: [0.1, 0.2, 0.3] }));
vi.mock('../../src/flows/embedText.js', () => ({ embedTextFlow: mockEmbed }));

const mockGenerateIcon = vi.fn(async () => ({ imageBase64: 'QUJD', contentType: 'image/png' }));
vi.mock('../../src/flows/generateCanonIcon.js', () => ({
  generateCanonIconFlow: mockGenerateIcon,
}));

const mockRemoveBg = vi.fn(async () => Buffer.from([1, 2, 3]));
vi.mock('../../src/imaging/removeFlatBackground.js', () => ({
  removeFlatBackground: mockRemoveBg,
}));

// Firestore admin: capture the embedding/thumbnail write-backs without a real DB.
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockGet = vi.fn().mockResolvedValue({ exists: false });
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => '__delete__' },
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({ update: mockUpdate, get: mockGet }),
    }),
  }),
}));

const mockSave = vi.fn(async () => undefined);
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({ name: 'demo-salt.appspot.com', file: () => ({ save: mockSave }) }),
  }),
}));

const mockFlush = vi.fn().mockResolvedValue(undefined);
// The trigger's trace helper (triggerTraceContext.ts) is NOT mocked, so it
// resolves the REAL runWithSuppliedTraceContext from this mocked module — it must
// exist or the helper throws. The mock just runs the fn (no real OTel context in
// unit tests); the assertions below verify it is invoked with the doc traceContext.
const mockRunWithSupplied = vi.fn(<T>(_traceparent: string | undefined, fn: () => T): T => fn());

vi.mock('@salt/observability/server', () => ({
  flushServerObservability: mockFlush,
  runWithSuppliedTraceContext: mockRunWithSupplied,
  // reportServerError.js (imported transitively by the trigger) constructs this
  // at module load — it must exist on the mock or the import throws.
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

const { onCanonItemWritten } = await import('../../src/triggers/onCanonItemWritten.js');

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

function makeCanonItem(id: string, overrides: Partial<CanonItemDoc> = {}): CanonItemDoc {
  return {
    id,
    schemaVersion: 5,
    name: 'Baked Beans',
    synonyms: [],
    aisleId: 'tinned',
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(id: string, after: CanonItemDoc | null, before?: CanonItemDoc | null) {
  return {
    params: { id },
    data: {
      before: before
        ? { exists: true, data: () => before }
        : { exists: false, data: () => undefined },
      after: after ? { exists: true, data: () => after } : { exists: false, data: () => undefined },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ exists: false }); // devSettings missing → icon enabled
});

describe('onCanonItemWritten — trace propagation (traceContext correlation field)', () => {
  it('runs the icon + embedding work within the doc traceContext', async () => {
    const item = makeCanonItem('canon-1', { traceContext: TRACEPARENT });

    await (onCanonItemWritten as Function)(makeEvent('canon-1', item));

    // The allSettled side-effect block ran inside runWithSuppliedTraceContext with
    // the exact traceparent the match trigger stamped on the canon doc.
    expect(mockRunWithSupplied).toHaveBeenCalledWith(TRACEPARENT, expect.any(Function));
    // And the work actually executed (icon + embedding fired).
    expect(mockGenerateIcon).toHaveBeenCalledOnce();
    expect(mockEmbed).toHaveBeenCalledOnce();
  });

  it('degrades to a normal root trace when the canon doc has no traceContext', async () => {
    const item = makeCanonItem('canon-2'); // no traceContext

    await (onCanonItemWritten as Function)(makeEvent('canon-2', item));

    // Wrapper still runs the work, but with an undefined traceparent → root trace.
    expect(mockRunWithSupplied).toHaveBeenCalledWith(undefined, expect.any(Function));
    expect(mockGenerateIcon).toHaveBeenCalledOnce();
    expect(mockEmbed).toHaveBeenCalledOnce();
  });

  it('does not throw on a malformed traceContext and still flushes', async () => {
    const item = makeCanonItem('canon-3', { traceContext: 'not-a-valid-traceparent' });

    await expect(
      (onCanonItemWritten as Function)(makeEvent('canon-3', item)),
    ).resolves.toBeUndefined();

    // A bad id costs at most a split trace — the work still runs and the flush
    // in the finally executes (Rule 10).
    expect(mockEmbed).toHaveBeenCalledOnce();
    expect(mockFlush).toHaveBeenCalled();
  });

  it('a bare traceContext-only write does not loop into duplicate icon/embedding work', async () => {
    // before and after are identical except an added traceContext (the stamp the
    // match write-back makes). thumbnail stays null, embedding already present →
    // the edge-trigger icon guard and the embedding guard both skip, so the
    // traceContext re-fire is a no-op for both branches.
    const before = makeCanonItem('canon-loop', { thumbnail: null, embedding: [0.5] });
    const after = makeCanonItem('canon-loop', {
      thumbnail: null,
      embedding: [0.5],
      traceContext: TRACEPARENT,
    });

    await (onCanonItemWritten as Function)(makeEvent('canon-loop', after, before));

    expect(mockGenerateIcon).not.toHaveBeenCalled();
    expect(mockEmbed).not.toHaveBeenCalled();
  });
});
