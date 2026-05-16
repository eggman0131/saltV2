import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CanonItem } from '@salt/domain';

// ─── In-memory Firestore mock ─────────────────────────────────────────────────

const collections = new Map<string, Map<string, Record<string, unknown>>>();

function getCollection(name: string) {
  let c = collections.get(name);
  if (!c) {
    c = new Map();
    collections.set(name, c);
  }
  return c;
}

function resetFirestore() {
  collections.clear();
}

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name: string) => {
      const store = getCollection(name);
      return {
        doc: (id: string) => ({
          async set(data: Record<string, unknown>) {
            store.set(id, data);
          },
          async get() {
            return {
              exists: store.has(id),
              data: () => store.get(id),
            };
          },
          async delete() {
            store.delete(id);
          },
        }),
        async get() {
          return {
            docs: [...store.values()].map((data) => ({ data: () => data })),
          };
        },
      };
    },
  }),
}));

// ─── Mock Genkit so defineFlow returns the handler directly ───────────────────

vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_cfg: unknown, handler: unknown) => handler,
  },
}));

// ─── Mock the AI flows ────────────────────────────────────────────────────────

const mockEmbed = vi.fn(async (_input: { text: string }) => ({ values: [0, 0, 0] }));
const mockArbitrate = vi.fn();

vi.mock('../../src/flows/embedText.js', () => ({
  embedTextFlow: (input: { text: string }) => mockEmbed(input),
}));
vi.mock('../../src/flows/arbitrateCanon.js', () => ({
  arbitrateCanonFlow: (input: unknown) => mockArbitrate(input),
}));

// Import after all mocks so the module graph picks them up.
const { matchOrCreateCanonFlow } = await import('../../src/flows/matchOrCreateCanon.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedCanonItem(item: CanonItem): void {
  getCollection('canonItems').set(item.id, { ...item });
}

function seedAisles(aisles: Array<{ id: string; name: string; order: number }>): void {
  getCollection('canonData').set('aisles', { aisles });
}

function readCanonStorage(): CanonItem[] {
  return [...getCollection('canonItems').values()] as unknown as CanonItem[];
}

function makeItem(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    schemaVersion: 5,
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

beforeEach(() => {
  resetFirestore();
  mockEmbed.mockClear();
  mockArbitrate.mockReset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('matchOrCreateCanon flow', () => {
  it('returns ValidationError envelope when rawName is empty', async () => {
    const result = await (matchOrCreateCanonFlow as Function)({ rawName: '   ' });
    expect(result.kind).toBe('err');
    expect(result.error.kind).toBe('ValidationError');
  });

  it('creates a new item when forceCreate is true and persists it to Firestore', async () => {
    const result = await (matchOrCreateCanonFlow as Function)({
      rawName: 'Tomato',
      forceCreate: true,
    });

    expect(result.kind).toBe('ok');
    expect(result.value.decision).toBe('created');
    expect(result.value.item.name).toBe('Tomato');

    const stored = readCanonStorage();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(result.value.item.id);
    expect(stored[0]!.name).toBe('Tomato');
  });

  it('matches an existing item via stage-1 normalised-name match', async () => {
    const existing = makeItem({ id: 'tomato-1', name: 'Tomato' });
    seedCanonItem(existing);

    const result = await (matchOrCreateCanonFlow as Function)({ rawName: 'tomato' });

    expect(result.kind).toBe('ok');
    expect(result.value.decision).toBe('matched');
    expect(result.value.item.id).toBe('tomato-1');
    expect(mockArbitrate).not.toHaveBeenCalled();
  });

  it('routes to AI arbitration when stage 1 is ambiguous and persists the chosen item', async () => {
    seedAisles([{ id: 'produce', name: 'Produce', order: 0 }]);
    seedCanonItem(makeItem({ id: 'tomato-a', name: 'Tomato' }));
    seedCanonItem(makeItem({ id: 'tomato-b', name: 'Tomato' }));

    mockArbitrate.mockResolvedValueOnce({
      kind: 'match',
      itemId: 'tomato-b',
      confidence: 0.95,
      shoppingBehavior: 'needed',
      prompt: '',
      rawResponse: '',
    });

    const result = await (matchOrCreateCanonFlow as Function)({ rawName: 'tomato' });

    expect(result.kind).toBe('ok');
    expect(result.value.decision).toBe('ai_arbitrated');
    expect(result.value.item.id).toBe('tomato-b');
    expect(mockArbitrate).toHaveBeenCalledOnce();
  });

  it('falls back to highest-confidence shortlist candidate on AI no-match', async () => {
    // Two items with the same normalised name — triggers ambiguous → AI arbitration.
    seedCanonItem(makeItem({ id: 'a-1', name: 'apple' }));
    seedCanonItem(makeItem({ id: 'a-2', name: 'apple' }));

    mockArbitrate.mockResolvedValueOnce({
      kind: 'no-match',
      prompt: '',
      rawResponse: '',
    });

    const result = await (matchOrCreateCanonFlow as Function)({ rawName: 'apple' });

    // Falls back to the first shortlist candidate rather than creating a duplicate.
    expect(result.kind).toBe('ok');
    expect(result.value.decision).toBe('ai_arbitrated');
    expect(['a-1', 'a-2']).toContain(result.value.item.id);
  });

  it('respects selectedAisleId on a brand-new item', async () => {
    seedAisles([{ id: 'produce', name: 'Produce', order: 0 }]);

    const result = await (matchOrCreateCanonFlow as Function)({
      rawName: 'Cucumber',
      selectedAisleId: 'produce',
      forceCreate: true,
    });

    expect(result.kind).toBe('ok');
    expect(result.value.decision).toBe('created');
    expect(result.value.item.aisleId).toBe('produce');
    // arbitration is skipped when the caller chose an aisle.
    expect(mockArbitrate).not.toHaveBeenCalled();
  });
});
