import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-node';
import type { Context } from '@opentelemetry/api';
import type { CanonItem } from '@salt/domain';
import { startSpan } from '@salt/observability/server';
import { createFirestoreCanonStore } from '../../src/adapters/firestoreCanonStore.js';

// ─── Phase 2: infra spans inside canon matching nest under the parent ─────────
//
// The canon match parent span (canon.matchOrCreateCanon / the recipe batch
// span) is created with a plain startSpan and is NOT the active OTel context
// during adapter execution. So the Firestore canon-store child spans
// ("Firestore: load canon candidates" / "Firestore: write canon item") must be
// parented EXPLICITLY via the threaded parentSpan — relying on context.active()
// alone would re-root them. This test registers a REAL recording tracer provider
// (so startSpan produces real spans, not the no-op spans you get when Firebase
// telemetry is off) and asserts each child span's parentSpanId points at the
// threaded parent — i.e. the trace reads as a tree, not N re-rooted spans.

// Capture every finished span by name → its parentSpanId, via a tiny processor.
const finished = new Map<string, ReadableSpan>();
const captureProcessor: SpanProcessor = {
  onStart(_span: ReadableSpan, _ctx: Context): void {},
  onEnd(span: ReadableSpan): void {
    finished.set(span.name, span);
  },
  async forceFlush(): Promise<void> {},
  async shutdown(): Promise<void> {},
};

let provider: NodeTracerProvider;

beforeAll(() => {
  // OTel 1.25.1: processors are attached via addSpanProcessor, not a constructor
  // option. register() installs this as the global provider so the
  // @salt/observability/server startSpan (which reads the global tracer)
  // produces real recording spans this processor can capture.
  provider = new NodeTracerProvider();
  provider.addSpanProcessor(captureProcessor);
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
});

beforeEach(() => {
  finished.clear();
});

function makeCanonDoc(id: string, name: string): Record<string, unknown> {
  // Must satisfy CanonItemSchema so list() counts it as a candidate (invalid
  // docs are skipped). Mirrors the makeItem helper in matchOrCreateCanon.test.ts.
  return {
    id,
    name,
    schemaVersion: 5,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
  };
}

// Minimal Firestore stub: just enough surface for list()/upsert(). Returns two
// schema-valid canon docs so list() reports a candidate count of 2.
function makeDbStub() {
  const docs = [makeCanonDoc('a', 'Apple'), makeCanonDoc('b', 'Banana')];
  return {
    collection: () => ({
      doc: () => ({
        async set() {},
      }),
      async get() {
        return { docs: docs.map((d) => ({ id: d['id'], data: () => d })) };
      },
    }),
  } as unknown as Parameters<typeof createFirestoreCanonStore>[0];
}

const sampleItem = makeCanonDoc('a', 'Apple') as unknown as CanonItem;

describe('firestoreCanonStore — infra spans nest under the threaded parent', () => {
  it('list() opens "Firestore: load canon candidates" as a child of the parent span', async () => {
    const parent = startSpan('canon.matchOrCreateCanon: apple');
    try {
      const store = createFirestoreCanonStore(makeDbStub(), parent);
      await store.list();
    } finally {
      parent.end();
    }

    const parentId = finished.get('canon.matchOrCreateCanon: apple')?.spanContext().spanId;
    const child = finished.get('Firestore: load canon candidates');
    expect(parentId).toBeDefined();
    expect(child).toBeDefined();
    // The whole point: the child parents under the canon span, not a fresh root.
    expect(child!.parentSpanId).toBe(parentId);
    // Same trace, too.
    expect(child!.spanContext().traceId).toBe(
      finished.get('canon.matchOrCreateCanon: apple')!.spanContext().traceId,
    );
    // Candidate count (scoring input cardinality) is captured as a scalar attr.
    expect(child!.attributes['canon.candidateCount']).toBe(2);
  });

  it('upsert() opens "Firestore: write canon item" as a child of the parent span', async () => {
    const parent = startSpan('canon.matchOrCreateCanon: apple');
    try {
      const store = createFirestoreCanonStore(makeDbStub(), parent);
      await store.upsert(sampleItem);
    } finally {
      parent.end();
    }

    const parentId = finished.get('canon.matchOrCreateCanon: apple')?.spanContext().spanId;
    const child = finished.get('Firestore: write canon item');
    expect(parentId).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.parentSpanId).toBe(parentId);
    expect(child!.attributes['canon.itemId']).toBe('a');
  });

  it('without a threaded parent the child span re-roots (it does NOT inherit the parent it was never given)', async () => {
    // Sanity: the nesting comes from the explicit thread, not ambient magic. A
    // store built with no parent and run outside any active span produces a
    // root child span (no parentSpanId) — exactly why the parent MUST be
    // threaded in production rather than relying on context.active().
    const store = createFirestoreCanonStore(makeDbStub());
    await store.list();

    const child = finished.get('Firestore: load canon candidates');
    expect(child).toBeDefined();
    expect(child!.parentSpanId).toBeUndefined();
  });
});
