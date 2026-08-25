/**
 * Characterisation net for the THREE Tier-1 icon triggers (issue #989, Phase 1).
 *
 * `onCanonItemWritten` (#148), `onProductFormWritten` (#871) and
 * `onKitchenToolWritten` (#882) are one pipeline written out three times: the
 * same edge-trigger decision, the same kill switch, the same
 * background-removal → framing → upload → write-back chain, differing only in
 * collection, storage prefix, subject field and flow. #989 collapses them onto
 * one descriptor-driven module; this suite is the net that has to stay green,
 * untouched, across that move — so it is written as a TABLE over the three
 * families rather than as three copied files (UT-D1).
 *
 * It descends from `onCanonItemWritten.emulator.test.ts`, which covered exactly
 * this matrix for one family. `onKitchenToolWritten` had no test file at all
 * before this; `onProductFormWritten` had only its pure `iconNeedsGeneration`
 * (which stays where it is, in `onProductFormWritten.test.ts`).
 *
 * WHY AN EMULATOR SUITE AND NOT UNIT TESTS. CF unit tests replace
 * `ai.defineFlow` with the identity function, so a mocked unit test never runs
 * the real pipeline (recorded in #941). The write-back, the kill-switch read and
 * the hint clear are Firestore facts, and this is the only place in the repo
 * that can observe them.
 *
 * MOCK BUDGET (UT-B1). Nine `vi.mock` calls, over the cap of five, and the seam
 * cannot be narrowed: the isolated Vitest stack (docker-compose.vitest.yml) runs
 * Firestore + Auth ONLY — no Storage emulator and no Gemini — so the two AI
 * flows and `firebase-admin/storage` have no real implementation to reach here;
 * `sharp` (both imaging modules) rejects the synthetic buffers a test can
 * produce; and the three `firebase-functions*` entries are platform shims with
 * no runtime outside a deployed function. Firestore itself is NOT mocked, which
 * is the point of the file. Note the direction of travel: this replaces one file
 * that already carried seven, and spares the two new families a copy each.
 *
 * Run via: pnpm test:emulator
 */

process.env['FIRESTORE_EMULATOR_HOST'] =
  `127.0.0.1:${process.env['VITE_EMULATOR_FIRESTORE_PORT'] ?? '8080'}`;

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { KITCHEN_TOOLS_COLLECTION } from '@salt/domain/schemas';

// ─── Mocks (everything except firebase-admin/firestore) ──────────────────────

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => '' }),
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockEmbed = vi.fn(async () => ({ values: [0.1, 0.2, 0.3] }));
vi.mock('../../src/flows/embedText.js', () => ({ embedTextFlow: mockEmbed }));

// Canon items AND product forms both draw through `generateCanonIconFlow` —
// three flows serve four families, and the trigger names its flow rather than
// assuming one per collection.
const mockCanonIconFlow = vi.fn();
vi.mock('../../src/flows/generateCanonIcon.js', () => ({
  generateCanonIconFlow: mockCanonIconFlow,
}));

const mockKitchenToolIconFlow = vi.fn();
vi.mock('../../src/flows/generateKitchenToolIcon.js', () => ({
  generateKitchenToolIconFlow: mockKitchenToolIconFlow,
}));

const mockRemoveBg = vi.fn(async () => Buffer.from([1, 2, 3]));
vi.mock('../../src/imaging/removeFlatBackground.js', () => ({
  removeFlatBackground: mockRemoveBg,
}));

// The icon pipeline re-frames after background removal. Mocked alongside it:
// the real normaliser runs sharp, which would reject this fake buffer.
const mockReframe = vi.fn(async (buf: Buffer) => buf);
vi.mock('../../src/imaging/normalizeIconFraming.js', () => ({
  normalizeIconFraming: mockReframe,
}));

/** Every `file(path).save(buffer, options)` this run made, in order. */
const saved: { path: string; options: unknown }[] = [];
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      name: 'demo-salt.appspot.com',
      file: (path: string) => ({
        save: async (_webp: Buffer, options: unknown) => {
          saved.push({ path, options });
        },
      }),
    }),
  }),
}));

const { onCanonItemWritten } = await import('../../src/triggers/onCanonItemWritten.js');
const { onProductFormWritten } = await import('../../src/triggers/onProductFormWritten.js');
const { onKitchenToolWritten } = await import('../../src/triggers/onKitchenToolWritten.js');

// ─── Setup ───────────────────────────────────────────────────────────────────

const PROJECT_ID = 'demo-salt';
const EMULATOR_HOST = process.env['FIRESTORE_EMULATOR_HOST'] as string;
const BUCKET = 'demo-salt.appspot.com';
const UPLOAD_OPTIONS = {
  contentType: 'image/webp',
  metadata: { cacheControl: 'public, max-age=31536000, immutable' },
};
const GENERATED = { imageBase64: 'QUJD', contentType: 'image/png' };

let adminApp: App;

type Doc = Record<string, unknown>;

function makeCanonItem(id: string, overrides: Doc = {}): Doc {
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

function makeProductForm(id: string, overrides: Doc = {}): Doc {
  return {
    id,
    schemaVersion: 1,
    matchers: ['lime juice'],
    parentCanonId: 'c-lime',
    label: 'Lime juice',
    yield: { formUnit: 'ml', amountPerParent: 30 },
    thumbnail: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeKitchenTool(id: string, overrides: Doc = {}): Doc {
  return {
    id,
    schemaVersion: 1,
    label: 'Mixing bowl',
    matchers: ['bowl'],
    thumbnail: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** The five axes the three triggers differ on, and nothing else. */
interface IconFamily {
  /** Names the row in every failure message (UT-D2). */
  readonly name: string;
  readonly collection: string;
  readonly storagePrefix: string;
  readonly handler: (event: unknown) => Promise<void>;
  readonly make: (id: string, overrides?: Doc) => Doc;
  /** The document field the picture's subject is read from. */
  readonly subjectField: string;
  readonly subject: string;
  /** The flow this family draws through. Canon and forms share one. */
  readonly flow: ReturnType<typeof vi.fn>;
  /** The exact argument object the flow must receive. */
  readonly flowInput: (subject: string, hint?: string) => Doc;
  /** A write that touches the document but not the icon fields. */
  readonly unrelatedEdit: Doc;
}

const FAMILIES: IconFamily[] = [
  {
    name: 'canonItems',
    collection: 'canonItems',
    storagePrefix: 'canon-icons',
    handler: onCanonItemWritten as unknown as (event: unknown) => Promise<void>,
    make: makeCanonItem,
    subjectField: 'name',
    subject: 'Baked Beans',
    flow: mockCanonIconFlow,
    flowInput: (subject, hint) => ({ name: subject, ...(hint ? { hint } : {}) }),
    // A traceContext stamp, as a canon-match write-back makes.
    unrelatedEdit: { traceContext: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' },
  },
  {
    name: 'productForms',
    collection: 'productForms',
    storagePrefix: 'product-form-icons',
    handler: onProductFormWritten as unknown as (event: unknown) => Promise<void>,
    make: makeProductForm,
    subjectField: 'label',
    subject: 'Lime juice',
    // Deliberately the CANON flow: a form is a grocery, so it draws through the
    // grocery prompt. "Family" is not one-to-one with "flow".
    flow: mockCanonIconFlow,
    flowInput: (subject, hint) => ({ name: subject, ...(hint ? { hint } : {}) }),
    // The admin catalog saves field-by-field on blur, so this is the real hazard.
    unrelatedEdit: { matchers: ['lime juice', 'fresh lime juice'] },
  },
  {
    name: 'kitchenTools',
    collection: KITCHEN_TOOLS_COLLECTION,
    storagePrefix: 'kit-icons',
    handler: onKitchenToolWritten as unknown as (event: unknown) => Promise<void>,
    make: makeKitchenTool,
    subjectField: 'label',
    subject: 'Mixing bowl',
    flow: mockKitchenToolIconFlow,
    flowInput: (subject, hint) => ({ label: subject, ...(hint ? { hint } : {}) }),
    unrelatedEdit: { matchers: ['bowl', 'large bowl'] },
  },
];

async function clearEmulator(): Promise<void> {
  const url = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Failed to clear emulator: HTTP ${resp.status}`);
  }
}

function makeEvent(id: string, after: Doc | null, before?: Doc | null) {
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

function downloadUrl(prefix: string, id: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${prefix}%2F${id}.webp?alt=media`;
}

async function setDevSettings(value: Doc | null): Promise<void> {
  const ref = getFirestore(adminApp).collection('devSettings').doc('singleton');
  if (value === null) await ref.delete();
  else await ref.set(value);
}

beforeAll(() => {
  adminApp = initializeApp({ projectId: PROJECT_ID });
});

afterAll(async () => {
  delete process.env['FUNCTIONS_AI_FAKE'];
  await deleteApp(adminApp);
});

beforeEach(async () => {
  await clearEmulator();
  vi.clearAllMocks();
  saved.length = 0;
  // Implementations are re-installed rather than relied on: `clearAllMocks`
  // leaves them in place today, but a row that queues a rejection must not be
  // able to leak into the next row of a suite that runs `isolate: false`.
  mockCanonIconFlow.mockImplementation(async () => GENERATED);
  mockKitchenToolIconFlow.mockImplementation(async () => GENERATED);
  mockEmbed.mockImplementation(async () => ({ values: [0.1, 0.2, 0.3] }));
  delete process.env['FUNCTIONS_AI_FAKE'];
});

// ─── The shared matrix ───────────────────────────────────────────────────────

describe.each(FAMILIES)('$name — Tier-1 icon pipeline', (family: IconFamily) => {
  const ref = (id: string) => getFirestore(adminApp).collection(family.collection).doc(id);

  async function seed(id: string, doc: Doc): Promise<void> {
    await ref(id).set(doc);
  }

  async function fire(id: string, after: Doc | null, before?: Doc | null): Promise<void> {
    await family.handler(makeEvent(id, after, before));
  }

  async function stored(id: string): Promise<Doc> {
    return (await ref(id).get()).data() as Doc;
  }

  /**
   * The #928 guard made mechanical. A "must not generate" row is only evidence
   * if the fixture actually REACHED the guard — a row can otherwise pass because
   * the trigger never saw the document at all. So every negative row is stated as
   * a pair: `blocked` runs it and must draw nothing, then `released` removes the
   * ONE thing holding it back and must draw. A fixture that was never seen fails
   * the second half.
   *
   * Each half carries its own observable assertion (UT-A1); the call-count checks
   * here are the mutation proof on top of that, not the substance of the row.
   */
  async function provedByMutation(
    blocked: () => Promise<void>,
    released: () => Promise<void>,
  ): Promise<void> {
    await blocked();
    expect(
      family.flow,
      'the blocked half drew an icon it should have skipped',
    ).not.toHaveBeenCalled();
    expect(saved, 'the blocked half uploaded an icon it should have skipped').toEqual([]);

    vi.clearAllMocks();
    saved.length = 0;
    mockCanonIconFlow.mockImplementation(async () => GENERATED);
    mockKitchenToolIconFlow.mockImplementation(async () => GENERATED);

    await released();
    expect(
      family.flow,
      'the mutation control drew nothing — this fixture never reached the guard, so the ' +
        'blocked half proves nothing (#928)',
    ).toHaveBeenCalledOnce();
  }

  it('draws, uploads and writes the download URL when a create arrives with a null thumbnail', async () => {
    const doc = family.make('fresh');
    await seed('fresh', doc);

    await fire('fresh', doc);

    expect(family.flow).toHaveBeenCalledWith(family.flowInput(family.subject));
    expect(mockRemoveBg).toHaveBeenCalledOnce();
    // Framing runs after background removal, at the icon tile's contentMax — not
    // the normaliser's own 92px weather-watermark default.
    expect(mockReframe).toHaveBeenCalledWith(expect.anything(), { contentMax: 108 });
    expect(saved).toEqual([
      { path: `${family.storagePrefix}/fresh.webp`, options: UPLOAD_OPTIONS },
    ]);
    expect((await stored('fresh'))['thumbnail']).toBe(downloadUrl(family.storagePrefix, 'fresh'));
  });

  it('never redraws an item that already has an icon URL', async () => {
    const url = 'https://example.invalid/already-drawn.webp';
    await provedByMutation(
      async () => {
        const doc = family.make('has-url', { thumbnail: url });
        await seed('has-url', doc);
        await fire('has-url', doc);
        expect((await stored('has-url'))['thumbnail']).toBe(url);
      },
      async () => {
        const doc = family.make('has-url', { thumbnail: null });
        await seed('has-url', doc);
        await fire('has-url', doc);
      },
    );
  });

  it('skips forever once the thumbnail is the hidden sentinel', async () => {
    await provedByMutation(
      async () => {
        const doc = family.make('opted-out', { thumbnail: 'hidden' });
        await seed('opted-out', doc);
        await fire('opted-out', doc);
        expect((await stored('opted-out'))['thumbnail']).toBe('hidden');
      },
      async () => {
        const doc = family.make('opted-out', { thumbnail: null });
        await seed('opted-out', doc);
        await fire('opted-out', doc);
      },
    );
  });

  it('does not start a duplicate when an unrelated field changes while the thumbnail stays null', async () => {
    // The re-entrancy guard: the write that FIRST set the thumbnail null owns the
    // in-flight generation, so a second write landing before it finishes must not
    // start a second drawing.
    const before = family.make('in-flight');
    await provedByMutation(
      async () => {
        const after = family.make('in-flight', family.unrelatedEdit);
        await seed('in-flight', after);
        await fire('in-flight', after, before);
        expect((await stored('in-flight'))['thumbnail']).toBeNull();
      },
      async () => {
        // The one thing that DOES re-fire an already-null item: the nonce.
        const after = family.make('in-flight', { ...family.unrelatedEdit, iconRequestedAt: 1 });
        await seed('in-flight', after);
        await fire('in-flight', after, before);
      },
    );
  });

  it('redraws when the thumbnail transitions from a URL to null', async () => {
    const before = family.make('cleared', { thumbnail: 'https://example.invalid/old.webp' });
    const after = family.make('cleared', { thumbnail: null });
    await seed('cleared', after);

    await fire('cleared', after, before);

    expect(family.flow).toHaveBeenCalledWith(family.flowInput(family.subject));
    expect((await stored('cleared'))['thumbnail']).toBe(
      downloadUrl(family.storagePrefix, 'cleared'),
    );
  });

  it('redraws when the regenerate nonce is bumped on an already-null thumbnail', async () => {
    const before = family.make('nonce-up', { iconRequestedAt: 1 });
    const after = family.make('nonce-up', { iconRequestedAt: 2 });
    await seed('nonce-up', after);

    await fire('nonce-up', after, before);

    expect(family.flow).toHaveBeenCalledWith(family.flowInput(family.subject));
    expect((await stored('nonce-up'))['thumbnail']).toBe(
      downloadUrl(family.storagePrefix, 'nonce-up'),
    );
  });

  it('does not redraw when the nonce is unchanged', async () => {
    const before = family.make('nonce-same', { iconRequestedAt: 7 });
    await provedByMutation(
      async () => {
        const after = family.make('nonce-same', { iconRequestedAt: 7, ...family.unrelatedEdit });
        await seed('nonce-same', after);
        await fire('nonce-same', after, before);
        expect((await stored('nonce-same'))['thumbnail']).toBeNull();
      },
      async () => {
        const after = family.make('nonce-same', { iconRequestedAt: 8, ...family.unrelatedEdit });
        await seed('nonce-same', after);
        await fire('nonce-same', after, before);
      },
    );
  });

  it('draws nothing while the dev kill-switch is off (#238)', async () => {
    await provedByMutation(
      async () => {
        await setDevSettings({ canonIconGenerationEnabled: false, schemaVersion: 1 });
        const doc = family.make('switch');
        await seed('switch', doc);
        await fire('switch', doc);
        // Thumbnail stays null so it can be drawn later if the switch comes back on.
        expect((await stored('switch'))['thumbnail']).toBeNull();
      },
      async () => {
        await setDevSettings({ canonIconGenerationEnabled: true, schemaVersion: 1 });
        const doc = family.make('switch');
        await seed('switch', doc);
        await fire('switch', doc);
      },
    );
  });

  it('draws when the dev kill-switch is explicitly on', async () => {
    await setDevSettings({ canonIconGenerationEnabled: true, schemaVersion: 1 });
    const doc = family.make('switch-on');
    await seed('switch-on', doc);

    await fire('switch-on', doc);

    expect((await stored('switch-on'))['thumbnail']).toBe(
      downloadUrl(family.storagePrefix, 'switch-on'),
    );
  });

  it('fails OPEN when the devSettings doc does not match its schema', async () => {
    // Clause 5 of the behavior contract: a shape mismatch defaults to ENABLED and
    // warns. A transient bad settings doc must never silently halt generation.
    await setDevSettings({ canonIconGenerationEnabled: 'nope', schemaVersion: 99 });
    const doc = family.make('bad-settings');
    await seed('bad-settings', doc);

    await fire('bad-settings', doc);

    expect((await stored('bad-settings'))['thumbnail']).toBe(
      downloadUrl(family.storagePrefix, 'bad-settings'),
    );
  });

  it('short-circuits before any model or Storage call under FUNCTIONS_AI_FAKE', async () => {
    await provedByMutation(
      async () => {
        process.env['FUNCTIONS_AI_FAKE'] = '1';
        const doc = family.make('faked');
        await seed('faked', doc);
        await fire('faked', doc);
        expect((await stored('faked'))['thumbnail']).toBeNull();
      },
      async () => {
        delete process.env['FUNCTIONS_AI_FAKE'];
        const doc = family.make('faked');
        await seed('faked', doc);
        await fire('faked', doc);
      },
    );
  });

  it('draws nothing for an empty subject', async () => {
    await provedByMutation(
      async () => {
        const doc = family.make('nameless', { [family.subjectField]: '   ' });
        await seed('nameless', doc);
        await fire('nameless', doc);
        expect((await stored('nameless'))['thumbnail']).toBeNull();
      },
      async () => {
        const doc = family.make('nameless', { [family.subjectField]: family.subject });
        await seed('nameless', doc);
        await fire('nameless', doc);
      },
    );
  });

  it('passes a one-shot icon hint to the flow and clears it in the write that sets the icon', async () => {
    const doc = family.make('hinted', { iconHint: 'show it as a tin' });
    await seed('hinted', doc);

    await fire('hinted', doc);

    expect(family.flow).toHaveBeenCalledWith(family.flowInput(family.subject, 'show it as a tin'));
    const after = await stored('hinted');
    expect(after['thumbnail']).toBe(downloadUrl(family.storagePrefix, 'hinted'));
    expect(after['iconHint']).toBeUndefined();
  });

  it('leaves the thumbnail null and does not reject when generation fails', async () => {
    family.flow.mockRejectedValue(new Error('model exploded'));
    const doc = family.make('doomed');
    await seed('doomed', doc);

    // Rule 10: the trigger reports and returns; it never rejects, because a
    // rejection would make the platform retry the whole invocation.
    await expect(fire('doomed', doc)).resolves.toBeUndefined();

    expect(saved).toEqual([]);
    expect((await stored('doomed'))['thumbnail']).toBeNull();
  });

  it('ignores a delete (no `after` document)', async () => {
    await fire('gone', null, family.make('gone'));

    expect(family.flow).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('skips a document whose shape does not parse', async () => {
    await fire('malformed', { id: 'malformed', schemaVersion: 999 });

    expect(family.flow).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });
});

// ─── Canon-only: the second, independently guarded branch ────────────────────

describe('onCanonItemWritten — embedding branch (canon only)', () => {
  const run = onCanonItemWritten as unknown as (event: unknown) => Promise<void>;
  const db = () => getFirestore(adminApp);

  it('writes the vector to the companion collection, not inline on the canon doc (#410)', async () => {
    const item = makeCanonItem('emb-fresh', { thumbnail: 'hidden', embedding: null });
    await db().collection('canonItems').doc('emb-fresh').set(item);

    await run(makeEvent('emb-fresh', item));

    const companion = await db().collection('canonEmbeddings').doc('emb-fresh').get();
    expect(companion.data()!['embedding']).toEqual([0.1, 0.2, 0.3]);
    const canon = await db().collection('canonItems').doc('emb-fresh').get();
    expect(canon.data()!['embedding'] ?? null).toBeNull();
  });

  it('skips when an inline (un-migrated) embedding is still present', async () => {
    const item = makeCanonItem('emb-inline', { thumbnail: 'hidden', embedding: [0.5] });
    await db().collection('canonItems').doc('emb-inline').set(item);

    await run(makeEvent('emb-inline', item));

    expect(mockEmbed).not.toHaveBeenCalled();
    const companion = await db().collection('canonEmbeddings').doc('emb-inline').get();
    expect(companion.exists).toBe(false);
  });

  it('skips when the relocated canonEmbeddings doc already exists (#410)', async () => {
    const item = makeCanonItem('emb-done', { thumbnail: 'hidden', embedding: null });
    await db().collection('canonItems').doc('emb-done').set(item);
    await db()
      .collection('canonEmbeddings')
      .doc('emb-done')
      .set({ embedding: [0.5] });

    await run(makeEvent('emb-done', item));

    expect(mockEmbed).not.toHaveBeenCalled();
    const companion = await db().collection('canonEmbeddings').doc('emb-done').get();
    expect(companion.data()!['embedding']).toEqual([0.5]);
  });

  it('runs independently of the icon kill-switch', async () => {
    // The switch governs image spend only. An environment with icons off still
    // gets its canon vectors, which is what keeps matching working.
    await db()
      .collection('devSettings')
      .doc('singleton')
      .set({ canonIconGenerationEnabled: false, schemaVersion: 1 });
    const item = makeCanonItem('emb-switch', { thumbnail: null, embedding: null });
    await db().collection('canonItems').doc('emb-switch').set(item);

    await run(makeEvent('emb-switch', item));

    const companion = await db().collection('canonEmbeddings').doc('emb-switch').get();
    expect(companion.data()!['embedding']).toEqual([0.1, 0.2, 0.3]);
    expect(
      (await db().collection('canonItems').doc('emb-switch').get()).data()!['thumbnail'],
    ).toBeNull();
  });

  it('leaves the icon branch alone when embedding fails', async () => {
    // `Promise.allSettled` pairs the two branches: neither can take the other
    // down, and neither can reject the handler.
    mockEmbed.mockRejectedValue(new Error('embedding exploded'));
    const item = makeCanonItem('emb-broken', { thumbnail: null, embedding: null });
    await db().collection('canonItems').doc('emb-broken').set(item);

    await expect(run(makeEvent('emb-broken', item))).resolves.toBeUndefined();

    expect((await db().collection('canonItems').doc('emb-broken').get()).data()!['thumbnail']).toBe(
      downloadUrl('canon-icons', 'emb-broken'),
    );
  });
});
