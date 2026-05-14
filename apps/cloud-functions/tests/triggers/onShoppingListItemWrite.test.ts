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

vi.mock('firebase-functions', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: vi.fn() },
}));

// ─── Mock firebase-admin/firestore ───────────────────────────────────────────

const mockUpdate = vi.fn().mockResolvedValue(undefined);

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

// ─── Mock @salt/ld-observability/server ──────────────────────────────────────

const mockSpan = {
  setAttribute: vi.fn(),
  end: vi.fn(),
};

vi.mock('@salt/ld-observability/server', () => ({
  startSpan: vi.fn(() => mockSpan),
  flushServerObservability: vi.fn().mockResolvedValue(undefined),
  whenServerObservabilityReady: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock matchOrCreate from @salt/domain ────────────────────────────────────

const mockMatchOrCreate = vi.fn();

vi.mock('@salt/domain', async (importOriginal) => {
  const original = await importOriginal<typeof import('@salt/domain')>();
  return { ...original, matchOrCreate: mockMatchOrCreate };
});

// ─── Mock buildMatchOrCreatePorts from the flow ──────────────────────────────

vi.mock('../../src/flows/matchOrCreateCanon.js', () => ({
  buildMatchOrCreatePorts: vi.fn(() => ({})),
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
  before?: ItemData | null;
  after?: ItemData | null;
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
    schemaVersion: 4,
    name: 'Test Item',
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    deletedAt: null,
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
        { rawName: 'heinz baked beans' },
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

      expect(mockMatchOrCreate).toHaveBeenCalledWith({ rawName: 'oat milk' }, expect.anything());
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
});
