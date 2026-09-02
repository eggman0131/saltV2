import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CanonItem } from '@salt/domain';

// ─── Mock firebase-functions/firestore ────────────────────────────────────────
// onDocumentWritten returns the handler directly so we can call it in tests.

vi.mock('firebase-functions/firestore', () => ({
  onDocumentWritten: (_path: unknown, handler: unknown) => handler,
}));

// ─── Mock firebase-functions logger ──────────────────────────────────────────

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('firebase-functions', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError },
}));

// ─── Mock firebase-admin/firestore ───────────────────────────────────────────

// The partial this trigger writes back — only the fields these assertions read
// (mirrors onRecipeWritten.test.ts's local `RecipePatch`).
type ShoppingListItemPatch = {
  canonId?: unknown;
  matchState?: unknown;
  rawText?: unknown;
  notes?: unknown;
  amount?: unknown;
  unit?: unknown;
};
const mockUpdate = vi
  .fn<(patch: ShoppingListItemPatch) => Promise<undefined>>()
  .mockResolvedValue(undefined);

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (_name: string) => ({
      doc: (_id: string) => ({
        collection: (_sub: string) => ({
          doc: (_itemId: string) => ({ update: mockUpdate }),
        }),
      }),
    }),
  }),
}));

// ─── Mock @salt/observability/server ──────────────────────────────────────────

const mockSpan = {
  setAttribute: vi.fn(),
  end: vi.fn(),
};

// Spy on the server error reporter the trigger now wires through
// ../observability/reportServerError.js (constructed at module load).
const mockReport = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);

// runWithSuppliedTraceContext is consumed by the Phase-5 trigger trace-context
// helper (triggerTraceContext.ts), which is NOT mocked, so it resolves the REAL
// import from this mocked module — it must exist or the helper throws. The mock
// just runs the fn (no real OTel context in unit tests); a dedicated test below
// asserts it is actually invoked with the doc's traceContext.
const mockRunWithSupplied = vi.fn(<T>(_traceparent: string | undefined, fn: () => T): T => fn());

vi.mock('@salt/observability/server', () => ({
  startSpan: vi.fn(() => mockSpan),
  flushServerObservability: mockFlush,
  initServerObservability: vi.fn(),
  isServerObservabilityInitialised: vi.fn(() => false),
  runWithSuppliedTraceContext: mockRunWithSupplied,
  createServerObservabilityMatchLoggingAdapter: vi.fn(() => ({
    write: vi.fn().mockResolvedValue(undefined),
  })),
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: mockReport })),
}));

// ─── Mock matchOrCreate from @salt/domain ────────────────────────────────────

const mockMatchOrCreate = vi.fn();

vi.mock('@salt/domain', async (importOriginal) => {
  const original = await importOriginal<typeof import('@salt/domain')>();
  return { ...original, matchOrCreate: mockMatchOrCreate };
});

// ─── Mock buildMatchOrCreatePorts from the flow ──────────────────────────────

const mockBuildPorts = vi.fn(() => ({}));
vi.mock('../../src/flows/matchOrCreateCanon.js', () => ({
  buildMatchOrCreatePorts: mockBuildPorts,
}));

// ─── Mock createServerEntryParseAdapter ──────────────────────────────────────

const mockEntryParseAdapterParse = vi.fn();

vi.mock('../../src/adapters/serverEntryParse.js', () => ({
  createServerEntryParseAdapter: vi.fn(() => ({ parse: mockEntryParseAdapterParse })),
}));

// Import after all mocks.
const { onShoppingListItemWrite } = await import('../../src/triggers/onShoppingListItemWrite.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ItemData {
  rawText: string;
  notes?: string;
  canonId: string | null;
  matchState: string;
  checked?: boolean;
}

function makeEvent({
  before,
  after,
  listId = 'list-1',
  itemId = 'item-1',
}: {
  // `Record<string, unknown>` is allowed alongside the well-formed shape so the
  // trust-boundary cases below can hand the trigger a document that does not
  // parse — which is the whole point of validating it.
  before?: ItemData | Record<string, unknown> | null;
  after?: ItemData | Record<string, unknown> | null;
  listId?: string;
  itemId?: string;
}) {
  return {
    params: { listId, itemId },
    data: {
      before: before
        ? { exists: true, data: () => before }
        : { exists: false, data: () => undefined },
      after: after ? { exists: true, data: () => after } : { exists: false, data: () => undefined },
    },
  };
}

function makeCanonItem(overrides: Partial<CanonItem> & { id: string }): CanonItem {
  return {
    schemaVersion: 5,
    name: 'Test Item',
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    ...overrides,
  };
}

const PENDING_ITEM: ItemData = {
  rawText: 'heinz baked beans',
  canonId: null,
  matchState: 'pending',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(undefined);
  mockMatchOrCreate.mockReset();
  // Default: AI fallback returns the full text unchanged (no split).
  mockEntryParseAdapterParse.mockImplementation(async (text: string) => ({
    kind: 'ok',
    value: { name: text, context: '' },
  }));
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('onShoppingListItemWrite', () => {
  describe('skip conditions', () => {
    it('skips on delete (after does not exist)', async () => {
      const event = makeEvent({ before: PENDING_ITEM, after: null });
      await (onShoppingListItemWrite as Function)(event);
      expect(mockMatchOrCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('skips when matchState is already matched (CF own write)', async () => {
      const event = makeEvent({
        after: { rawText: 'milk', canonId: 'canon-milk', matchState: 'matched' },
      });
      await (onShoppingListItemWrite as Function)(event);
      expect(mockMatchOrCreate).not.toHaveBeenCalled();
    });

    it('skips when matchState is needs_approval (CF own write)', async () => {
      const event = makeEvent({
        after: { rawText: 'milk', canonId: 'canon-milk', matchState: 'needs_approval' },
      });
      await (onShoppingListItemWrite as Function)(event);
      expect(mockMatchOrCreate).not.toHaveBeenCalled();
    });

    it('skips when matchState is failed (CF own write)', async () => {
      const event = makeEvent({
        after: { rawText: 'milk', canonId: null, matchState: 'failed' },
      });
      await (onShoppingListItemWrite as Function)(event);
      expect(mockMatchOrCreate).not.toHaveBeenCalled();
    });

    it('skips on notes-only edit (rawText unchanged, item existed)', async () => {
      const event = makeEvent({
        before: { rawText: 'milk', canonId: 'canon-milk', matchState: 'matched', notes: '' },
        after: { rawText: 'milk', canonId: null, matchState: 'pending', notes: 'organic' },
      });
      await (onShoppingListItemWrite as Function)(event);
      expect(mockMatchOrCreate).not.toHaveBeenCalled();
    });

    it('skips on check toggle (rawText unchanged, item existed)', async () => {
      const event = makeEvent({
        before: { rawText: 'milk', canonId: 'canon-milk', matchState: 'matched', checked: false },
        after: { rawText: 'milk', canonId: null, matchState: 'pending', checked: true },
      });
      await (onShoppingListItemWrite as Function)(event);
      expect(mockMatchOrCreate).not.toHaveBeenCalled();
    });
  });

  // ─── The trust boundary (issue #1127, Phase 3) ─────────────────────────────
  //
  // The document arrives from Firestore and is validated once, with `safeParse`,
  // like every other trigger here. A trigger has no caller to hand a Failure to,
  // so per docs/data-model.md the failure path is: log, return, never throw.

  describe('document validation', () => {
    it('logs and returns without a write when the document does not parse', async () => {
      // `rawText` present and the wrong TYPE. The old field-by-field read turned
      // this into `''` and matched on an empty string; it now stops here.
      const event = makeEvent({
        after: { rawText: 42, canonId: null, matchState: 'pending' },
      });

      await expect((onShoppingListItemWrite as Function)(event)).resolves.toBeUndefined();

      expect(mockLoggerError).toHaveBeenCalledWith(
        'onShoppingListItemWrite: invalid shoppingList item doc, skipping',
        expect.objectContaining({ listId: 'list-1', itemId: 'item-1' }),
      );
      expect(mockMatchOrCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('does not throw on a document that is not an object at all', async () => {
      const event = makeEvent({ after: 'not a document' as unknown as Record<string, unknown> });
      await expect((onShoppingListItemWrite as Function)(event)).resolves.toBeUndefined();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('still SKIPS a document carrying no matchState field at all', async () => {
      // The boundary of the change, and the reason `matchState` is still read off
      // the raw document. `ShoppingListItemSchema` gives it `.catch('pending')`,
      // so the parsed value for an absent field is 'pending' — which would send
      // this straight into the matcher. The skip guard is the brake on the
      // trigger's own write-back, so it must keep seeing what is stored.
      const event = makeEvent({ after: { rawText: 'milk', canonId: null } });
      await (onShoppingListItemWrite as Function)(event);
      expect(mockMatchOrCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('still SKIPS a document whose matchState is an unrecognised state', async () => {
      // Same reason: `.catch('pending')` would read a fifth state as 'pending'.
      const event = makeEvent({
        after: { rawText: 'milk', canonId: null, matchState: 'reticulating' },
      });
      await (onShoppingListItemWrite as Function)(event);
      expect(mockMatchOrCreate).not.toHaveBeenCalled();
    });

    it('reads an absent rawText/notes as blank and an absent canonId as null', async () => {
      // The schema's defaults reproduce the old fallbacks exactly, which is what
      // makes the swap safe for the guards above.
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'canon-1' }) },
      });

      const event = makeEvent({ after: { matchState: 'pending' } });
      await (onShoppingListItemWrite as Function)(event);

      // canonId absent → null → not a CF own write, so it proceeded; rawText
      // absent → '' → that is what reached the matcher.
      expect(mockMatchOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ rawName: '' }),
        expect.anything(),
      );
    });
  });

  describe('new item → matched', () => {
    it('calls matchOrCreate with the item rawText', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: {
          decision: 'matched',
          item: makeCanonItem({ id: 'canon-1', needs_approval: false }),
        },
      });

      const event = makeEvent({ before: null, after: PENDING_ITEM });
      await (onShoppingListItemWrite as Function)(event);

      expect(mockMatchOrCreate).toHaveBeenCalledWith(
        { rawName: 'heinz baked beans', rawText: 'heinz baked beans' },
        expect.anything(),
      );
    });

    it('writes canonId and matchState: matched when canon is approved', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: {
          decision: 'matched',
          item: makeCanonItem({ id: 'canon-1', needs_approval: false }),
        },
      });

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ canonId: 'canon-1', matchState: 'matched' }),
      );
    });
  });

  describe('new item → needs_approval canon', () => {
    it('writes matchState: needs_approval when matched canon has needs_approval: true', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: {
          decision: 'created',
          item: makeCanonItem({ id: 'canon-new', needs_approval: true }),
        },
      });

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ canonId: 'canon-new', matchState: 'needs_approval' }),
      );
    });
  });

  describe('rawText edit → re-match', () => {
    it('triggers when rawText changes even if item already existed', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: {
          decision: 'matched',
          item: makeCanonItem({ id: 'canon-2', needs_approval: false }),
        },
      });

      const event = makeEvent({
        before: { rawText: 'milk', canonId: 'canon-old', matchState: 'matched' },
        after: { rawText: 'oat milk', canonId: null, matchState: 'pending' },
      });
      await (onShoppingListItemWrite as Function)(event);

      expect(mockMatchOrCreate).toHaveBeenCalledWith(
        { rawName: 'oat milk', rawText: 'oat milk' },
        expect.anything(),
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ canonId: 'canon-2', matchState: 'matched' }),
      );
    });
  });

  describe('match failure → failed matchState', () => {
    it('writes matchState: failed when matchOrCreate returns an error', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'err',
        error: { kind: 'NetworkError', reason: 'transient' },
      });

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ matchState: 'failed' }));
      expect(mockUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ canonId: expect.anything() }),
      );
    });

    it('emits a summary log with errorCategory on failure', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'err',
        error: { kind: 'StorageError', reason: 'unavailable' },
      });

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'onShoppingListItemWrite',
        expect.objectContaining({ scope: 'shoppingListItem', errorCategory: 'StorageError' }),
      );
    });
  });

  describe('unexpected exception → failed matchState (never limbo)', () => {
    it('writes matchState: failed when matchOrCreate throws', async () => {
      mockMatchOrCreate.mockRejectedValue(new Error('arbitrateCanon timed out after 20000ms'));

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ matchState: 'failed' }));
      // A thrown error must not write a canonId — the item is terminal-uncategorised.
      expect(mockUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ canonId: expect.anything() }),
      );
    });

    it('does not rethrow — the handler resolves so the trigger is not retried into limbo', async () => {
      mockMatchOrCreate.mockRejectedValue(new Error('boom'));

      await expect(
        (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM })),
      ).resolves.toBeUndefined();
    });

    it('still ends the span and flushes when an exception is thrown', async () => {
      mockMatchOrCreate.mockRejectedValue(new Error('boom'));

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      expect(mockSpan.end).toHaveBeenCalled();
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'onShoppingListItemWrite',
        expect.objectContaining({ scope: 'shoppingListItem', errorCategory: 'exception' }),
      );
    });

    it('reports the unexpected error to PostHog and flushes before returning', async () => {
      const boom = new Error('arbitrateCanon timed out after 20000ms');
      mockMatchOrCreate.mockRejectedValue(boom);

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      // Additive to the logger: the raw error is reported, uncategorised
      // (undefined category → reportable). The terminal-state write succeeds, so
      // only the matchOrCreate throw is reported.
      expect(mockReport).toHaveBeenCalledWith(boom, undefined);
      // The flush in the finally runs after the report so the event is not
      // stranded when the function freezes.
      expect(mockFlush).toHaveBeenCalled();
    });

    it('does not attach the raw shopping-list text to the report payload', async () => {
      mockMatchOrCreate.mockRejectedValue(new Error('boom'));

      await (onShoppingListItemWrite as Function)(
        makeEvent({
          before: null,
          after: {
            rawText: 'two pounds of organic heirloom tomatoes',
            canonId: null,
            matchState: 'pending',
          },
        }),
      );

      // report() is called with only (error, category) — never the rawText. The
      // adapter forwards just the error/stack; free-form user content must not
      // ride along (CLAUDE.md §Observability).
      expect(mockReport).toHaveBeenCalledTimes(1);
      const reportArgs = mockReport.mock.calls[0]!;
      expect(reportArgs).toHaveLength(2);
      expect(JSON.stringify(reportArgs)).not.toContain('organic heirloom tomatoes');
    });

    it('swallows a failed terminal-state write so the handler still resolves', async () => {
      mockMatchOrCreate.mockRejectedValue(new Error('boom'));
      mockUpdate.mockRejectedValueOnce(new Error('firestore unavailable'));

      await expect(
        (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM })),
      ).resolves.toBeUndefined();
    });

    it('reports BOTH the unexpected error and the failed terminal-state write', async () => {
      const boom = new Error('boom');
      const writeErr = new Error('firestore unavailable');
      mockMatchOrCreate.mockRejectedValue(boom);
      mockUpdate.mockRejectedValueOnce(writeErr);

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      // The unexpected throw AND the StorageError-class terminal-write failure
      // each report — the item is stuck either way, so both are surfaced.
      expect(mockReport).toHaveBeenCalledWith(boom, undefined);
      expect(mockReport).toHaveBeenCalledWith(writeErr, undefined);
    });
  });

  describe('entry parsing', () => {
    it('feeds the clean parsed name to matchOrCreate for "for" entries', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      const event = makeEvent({
        before: null,
        after: { rawText: 'birthday card for bob', canonId: null, matchState: 'pending' },
      });
      await (onShoppingListItemWrite as Function)(event);

      expect(mockMatchOrCreate).toHaveBeenCalledWith(
        { rawName: 'birthday card', rawText: 'birthday card for bob' },
        expect.anything(),
      );
    });

    it('writes clean rawText and notes when context was extracted and notes is empty', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      const event = makeEvent({
        before: null,
        after: { rawText: 'birthday card for bob', canonId: null, matchState: 'pending' },
      });
      await (onShoppingListItemWrite as Function)(event);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ rawText: 'birthday card', notes: 'for bob' }),
      );
    });

    it('does not overwrite existing notes even when context is extracted', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      const event = makeEvent({
        before: null,
        after: {
          rawText: 'birthday card for bob',
          canonId: null,
          matchState: 'pending',
          notes: 'urgent',
        },
      });
      await (onShoppingListItemWrite as Function)(event);

      const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('rawText');
      expect(updateArg).not.toHaveProperty('notes');
    });

    it('does not write rawText or notes when no context was extracted', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      // 'milk' — 1 word, deterministic finds no split, looksCompound=false → no AI call
      const event = makeEvent({
        before: null,
        after: { rawText: 'milk', canonId: null, matchState: 'pending' },
      });
      await (onShoppingListItemWrite as Function)(event);

      const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('rawText');
      expect(updateArg).not.toHaveProperty('notes');
    });

    it('does not re-trigger after combined rawText+notes+matchState write', async () => {
      // Simulate the doc state after a combined write: matchState is 'matched', canonId set.
      const event = makeEvent({
        after: {
          rawText: 'birthday card',
          notes: 'for bob',
          canonId: 'c1',
          matchState: 'matched',
        },
      });
      await (onShoppingListItemWrite as Function)(event);

      expect(mockMatchOrCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('AI fallback', () => {
    it('calls AI adapter and uses its split for compound entries the deterministic parser missed', async () => {
      // 'olive oil garlic' — 3 words, no "for", deterministic finds no split → AI called
      mockEntryParseAdapterParse.mockResolvedValue({
        kind: 'ok',
        value: { name: 'olive oil', context: 'garlic' },
      });
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      const event = makeEvent({
        before: null,
        after: { rawText: 'olive oil garlic', canonId: null, matchState: 'pending' },
      });
      await (onShoppingListItemWrite as Function)(event);

      expect(mockMatchOrCreate).toHaveBeenCalledWith(
        { rawName: 'olive oil', rawText: 'olive oil garlic' },
        expect.anything(),
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ rawText: 'olive oil', notes: 'garlic' }),
      );
    });

    it('degrades gracefully to deterministic result when AI fallback returns Failure', async () => {
      mockEntryParseAdapterParse.mockResolvedValue({
        kind: 'err',
        error: { kind: 'NetworkError', reason: 'transient' },
      });
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      const event = makeEvent({
        before: null,
        after: { rawText: 'olive oil garlic', canonId: null, matchState: 'pending' },
      });
      await (onShoppingListItemWrite as Function)(event);

      // Deterministic found no split → full text as clean name, no extra write
      expect(mockMatchOrCreate).toHaveBeenCalledWith(
        { rawName: 'olive oil garlic', rawText: 'olive oil garlic' },
        expect.anything(),
      );
      const updateArg = mockUpdate.mock.calls[0]![0] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('rawText');
    });

    it('does not call AI adapter when deterministic parser already extracted a quantity', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      // 'baked beans 4 tins' — trailing quantity parsed deterministically; AI must not overwrite it
      const event = makeEvent({
        before: null,
        after: { rawText: 'baked beans 4 tins', canonId: null, matchState: 'pending' },
      });
      await (onShoppingListItemWrite as Function)(event);

      expect(mockEntryParseAdapterParse).not.toHaveBeenCalled();
      expect(mockMatchOrCreate).toHaveBeenCalledWith(
        { rawName: 'baked beans', rawText: 'baked beans 4 tins' },
        expect.anything(),
      );
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ amount: 4, unit: 'tins' }));
    });

    it('does not call AI adapter for short entries that cannot be compound', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      // 'oat milk' — 2 words, looksCompound=false
      const event = makeEvent({
        before: null,
        after: { rawText: 'oat milk', canonId: null, matchState: 'pending' },
      });
      await (onShoppingListItemWrite as Function)(event);

      expect(mockEntryParseAdapterParse).not.toHaveBeenCalled();
    });
  });

  describe('observability', () => {
    it('emits a summary log with scope, docId, errorCategory null on success', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      await (onShoppingListItemWrite as Function)(
        makeEvent({ before: null, after: PENDING_ITEM, itemId: 'item-99' }),
      );

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'onShoppingListItemWrite',
        expect.objectContaining({
          scope: 'shoppingListItem',
          docId: 'item-99',
          errorCategory: null,
        }),
      );
    });

    it('ends the span in the finally block', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  // ─── Trace propagation via the traceContext doc field (issue #362, Phase 5) ──
  describe('trace propagation (traceContext correlation field)', () => {
    const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

    function pendingWithTrace(traceContext?: string): Record<string, unknown> {
      return { ...PENDING_ITEM, ...(traceContext ? { traceContext } : {}) };
    }

    it('continues the browser-rooted trace: runs the match within the doc traceContext', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      await (onShoppingListItemWrite as Function)(
        makeEvent({ before: null, after: pendingWithTrace(TRACEPARENT) as unknown as ItemData }),
      );

      // The canon-matching work ran inside runWithSuppliedTraceContext with the
      // exact traceparent stamped on the doc by the browser.
      expect(mockRunWithSupplied).toHaveBeenCalledWith(TRACEPARENT, expect.any(Function));
    });

    it('threads traceContext into buildMatchOrCreatePorts so the canon write-back carries it', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      await (onShoppingListItemWrite as Function)(
        makeEvent({ before: null, after: pendingWithTrace(TRACEPARENT) as unknown as ItemData }),
      );

      // 2nd arg is the traceContext the canon store stamps onto the written doc,
      // so onCanonItemWritten can continue the same trace for the icon trigger.
      expect(mockBuildPorts).toHaveBeenCalledWith(mockSpan, TRACEPARENT);
    });

    it('degrades to a normal root trace when the doc has no traceContext', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      // Wrapper still runs (so the span/match path is unchanged), but with an
      // undefined traceparent → a plain root trace, never a thrown trigger.
      expect(mockRunWithSupplied).toHaveBeenCalledWith(undefined, expect.any(Function));
      expect(mockBuildPorts).toHaveBeenCalledWith(mockSpan, undefined);
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('does not throw on a malformed traceContext — the match still completes', async () => {
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      await expect(
        (onShoppingListItemWrite as Function)(
          makeEvent({
            before: null,
            after: pendingWithTrace('not-a-valid-traceparent') as unknown as ItemData,
          }),
        ),
      ).resolves.toBeUndefined();

      // Terminal success state is still written — a bad id costs at most a split
      // trace, never a failed match.
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ canonId: 'c1', matchState: 'matched' }),
      );
    });
  });

  // ─── The derived-name guard reaches this trigger (issue #937, Phase 1) ──────
  //
  // `buildMatchOrCreatePorts` now reads productForms and supplies `isDerivedName`
  // by default, which is what stops this trigger recording "garlic clove" as a
  // synonym of Garlic Bulbs. That default is only worth anything if the ports the
  // domain receives are the RESOLVED bag: the builder is async now, and a missing
  // `await` would hand `matchOrCreate` a Promise whose `isDerivedName` is
  // undefined — silently restoring the exact behaviour this phase removes, with
  // no type error at the call site (`MatchOrCreatePorts` fields are all optional
  // to read off `any`-shaped mocks). The end-to-end refusal itself is asserted
  // against the real builder in tests/flows/matchOrCreateCanon.test.ts.
  describe('port construction', () => {
    it('awaits the ports builder, so the resolved bag reaches matchOrCreate', async () => {
      const resolvedPorts = { isDerivedName: (name: string) => name === 'garlic cloves' };
      mockBuildPorts.mockImplementationOnce(
        () => Promise.resolve(resolvedPorts) as unknown as Record<string, unknown>,
      );
      mockMatchOrCreate.mockResolvedValue({
        kind: 'ok',
        value: { decision: 'matched', item: makeCanonItem({ id: 'c1', needs_approval: false }) },
      });

      await (onShoppingListItemWrite as Function)(makeEvent({ before: null, after: PENDING_ITEM }));

      expect(mockMatchOrCreate).toHaveBeenCalledWith(expect.anything(), resolvedPorts);
    });
  });
});
