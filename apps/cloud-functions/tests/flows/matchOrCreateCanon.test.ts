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

// Collections whose `.get()` rejects, so a test can drive the Rule 10 degrade
// path of a read that fails rather than merely returning nothing.
const failingReads = new Set<string>();

function resetFirestore() {
  collections.clear();
  failingReads.clear();
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
          if (failingReads.has(name)) throw new Error(`simulated ${name} read failure`);
          return {
            docs: [...store.values()].map((data, i) => ({
              id: `${name}-${i}`,
              data: () => data,
            })),
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
const { matchOrCreateCanonFlow, buildMatchOrCreatePorts } =
  await import('../../src/flows/matchOrCreateCanon.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedCanonItem(item: CanonItem): void {
  getCollection('canonItems').set(item.id, { ...item });
}

// Writes a doc that actually satisfies AislesDocumentSchema. `schemaVersion` and
// `updatedAt` are not decoration: without them the store's safeParse fails, the
// aisle load degrades to an empty list, and every "no candidates" input takes the
// create-without-AI branch instead of reaching arbitration — so a test meaning to
// exercise an AI path would quietly exercise the other one.
function seedAisles(aisles: Array<{ id: string; name: string; order: number }>): void {
  getCollection('canonData').set('aisles', { schemaVersion: 1, updatedAt: '', aisles });
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

// ─── The derived-name guard on the server entry points (issue #937, Phase 1) ──
//
// A synonym asserts IDENTITY; a product form asserts DERIVATION. Writing a
// derivative's name into the parent's synonym list makes stage 3 answer "a clove
// IS a bulb" for every later resolution, and the yield is silently lost — the
// #865/#866 harm verbatim. The guard lives in `appendCanonSynonym` and fires only
// when `ports.isDerivedName` is supplied; before this phase the callable and the
// shopping-list trigger supplied nothing, so the two busiest routes wrote the bad
// synonym while the fast path and the recipe batch refused it.

const GARLIC_BULBS = 'garlic-bulbs-1';

function seedGarlicCloveForm(): void {
  getCollection('productForms').set('form-garlic-clove', {
    id: 'form-garlic-clove',
    schemaVersion: 1,
    matchers: [],
    parentCanonId: GARLIC_BULBS,
    label: 'garlic clove',
    yield: { formUnit: 'count', amountPerParent: 10 },
    updatedAt: '',
    thumbnail: null,
  });
}

// "garlic cloves" clears no deterministic stage against "Garlic Bulbs" (token
// overlap 0.5, Levenshtein 0.583 — both under aiThreshold 0.60), so the shortlist
// is empty and the AI is asked to name a new item. It answers with a name the
// snapshot already holds, and the snapshot-name failsafe binds to the existing
// item — calling `resolveMatch` with the raw derivative text, which is where the
// synonym gets appended. That failsafe is one of the three routes the issue names,
// and its own code comment uses this exact "Garlic" example.
function arbitrateToExistingGarlicBulbs(): void {
  mockArbitrate.mockResolvedValueOnce({
    kind: 'new',
    canonName: 'Garlic Bulbs',
    aisleId: null,
    shoppingBehavior: 'needed',
    prompt: '',
    rawResponse: '',
  });
}

describe('matchOrCreateCanon flow — derived names never become synonyms', () => {
  it('binds "garlic cloves" to Garlic Bulbs without recording it as a synonym', async () => {
    seedAisles([{ id: 'produce', name: 'Produce', order: 0 }]);
    seedCanonItem(makeItem({ id: GARLIC_BULBS, name: 'Garlic Bulbs' }));
    seedGarlicCloveForm();
    arbitrateToExistingGarlicBulbs();

    const result = await (matchOrCreateCanonFlow as Function)({ rawName: 'garlic cloves' });

    expect(result.kind).toBe('ok');
    expect(result.value.decision).toBe('ai_arbitrated');
    expect(result.value.item.id).toBe(GARLIC_BULBS);
    // The match stands; only the identity claim is refused. No synonym, and no
    // needs_approval flip — the parent doc is not rewritten at all.
    expect(result.value.item.synonyms).toEqual([]);
    expect(result.value.item.needs_approval).toBe(false);
    const stored = readCanonStorage();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.synonyms).toEqual([]);
    expect(stored[0]!.needs_approval).toBe(false);
  });

  // The control for the case above: without a form claiming the name, the same
  // input still records the synonym. This is what makes the assertion above a
  // test of the guard rather than of the matcher happening not to write.
  it('still records a synonym when no product form claims the name', async () => {
    seedAisles([{ id: 'produce', name: 'Produce', order: 0 }]);
    seedCanonItem(makeItem({ id: GARLIC_BULBS, name: 'Garlic Bulbs' }));
    arbitrateToExistingGarlicBulbs();

    const result = await (matchOrCreateCanonFlow as Function)({ rawName: 'garlic cloves' });

    expect(result.kind).toBe('ok');
    expect(result.value.item.synonyms).toEqual(['garlic clove']);
  });

  // Rule 10 degrade, and the stated limit of the guarantee: a productForms read
  // that FAILS leaves the append exactly as it was before this phase existed. It
  // must never escalate to refusing synonyms wholesale.
  it('degrades to today’s behaviour when the productForms read fails', async () => {
    seedAisles([{ id: 'produce', name: 'Produce', order: 0 }]);
    seedCanonItem(makeItem({ id: GARLIC_BULBS, name: 'Garlic Bulbs' }));
    seedGarlicCloveForm();
    failingReads.add('productForms');
    arbitrateToExistingGarlicBulbs();

    const result = await (matchOrCreateCanonFlow as Function)({ rawName: 'garlic cloves' });

    expect(result.kind).toBe('ok');
    expect(result.value.item.id).toBe(GARLIC_BULBS);
    expect(result.value.item.synonyms).toEqual(['garlic clove']);
  });
});

describe('buildMatchOrCreatePorts', () => {
  // The shopping-list trigger calls the builder with no extras, so this is the
  // predicate the trigger now matches with.
  it('supplies a working isDerivedName by default, with no extras passed', async () => {
    seedGarlicCloveForm();

    const ports = await buildMatchOrCreatePorts();

    expect(ports.isDerivedName).toBeDefined();
    expect(ports.isDerivedName!('garlic cloves')).toBe(true);
    expect(ports.isDerivedName!('garlic bulbs')).toBe(false);
  });

  it('omits the predicate entirely when no product forms exist', async () => {
    const ports = await buildMatchOrCreatePorts();

    expect(ports.isDerivedName).toBeUndefined();
  });

  it('omits the predicate entirely when the productForms read fails', async () => {
    seedGarlicCloveForm();
    failingReads.add('productForms');

    const ports = await buildMatchOrCreatePorts();

    expect(ports.isDerivedName).toBeUndefined();
  });

  // The recipe batch overrides with a closure over its MUTABLE forms array, so a
  // form minted mid-batch protects the next item. The override must win, and must
  // not pay for a snapshot read it is about to discard.
  it('lets an explicit extras predicate win, and skips the read entirely', async () => {
    seedGarlicCloveForm();
    failingReads.add('productForms'); // would throw if the default read ran

    const override = (name: string) => name === 'anything at all';
    const ports = await buildMatchOrCreatePorts(undefined, undefined, {
      isDerivedName: override,
    });

    expect(ports.isDerivedName).toBe(override);
  });
});
