import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { matchOrCreate } from '@salt/domain';
import type { MatchLoggingPort, MatchOrCreateInput, MatchOrCreatePorts } from '@salt/domain';
import {
  createServerLDMatchLoggingAdapter,
  flushServerObservability,
  initServerObservability,
  isServerObservabilityInitialised,
  startSpan,
  whenServerObservabilityReady,
  type ObservabilitySpan,
} from '@salt/ld-observability/server';
import { ai } from '../genkit.js';
import { createFirestoreCanonStore } from '../adapters/firestoreCanonStore.js';
import { createFirestoreAisleStore } from '../adapters/firestoreAisleStore.js';
import { createServerEmbeddingAdapter } from '../adapters/serverEmbedding.js';
import { createServerArbitrationAdapter } from '../adapters/serverArbitration.js';
import { createServerMatchLoggingAdapter } from '../adapters/serverMatchLog.js';

const TraceSchema = z.record(z.string()).optional();

const InputSchema = z.object({
  rawName: z.string(),
  selectedAisleId: z.string().nullable().optional(),
  forceCreate: z.boolean().optional(),
  // W3C trace context piggy-backed on the payload because httpsCallable
  // doesn't surface request headers. Stripped before reaching the domain.
  _trace: TraceSchema,
});

// Output is the Result envelope produced by matchOrCreate. CanonItem and
// DomainError are validated upstream by the domain layer; modelling them
// again in zod would just duplicate that contract.
const OutputSchema = z.union([
  z.object({
    kind: z.literal('ok'),
    value: z.object({
      decision: z.enum(['created', 'matched', 'ai_arbitrated']),
      item: z.any(),
    }),
  }),
  z.object({
    kind: z.literal('err'),
    error: z.any(),
  }),
]);

function composeMatchLogging(...ports: MatchLoggingPort[]): MatchLoggingPort {
  return {
    async write(entry) {
      await Promise.allSettled(ports.map((p) => p.write(entry)));
    },
  };
}

export function buildMatchOrCreatePorts(parentSpan?: ObservabilitySpan): MatchOrCreatePorts {
  const db = getFirestore();
  return {
    store: createFirestoreCanonStore(db),
    aisleStore: createFirestoreAisleStore(db),
    embedding: createServerEmbeddingAdapter(),
    arbitration: createServerArbitrationAdapter(),
    ids: { newCanonId: () => crypto.randomUUID(), newAisleId: () => crypto.randomUUID() },
    logging: composeMatchLogging(
      createServerMatchLoggingAdapter(),
      createServerLDMatchLoggingAdapter(parentSpan),
    ),
  };
}

function ensureObservabilityInitialised(): void {
  if (isServerObservabilityInitialised()) return;
  // LD_SDK_KEY is bound on the matchOrCreateCanon callable's secrets list in
  // index.ts; absence here means LD observability is disabled for this env
  // (e.g. emulator without the secret) — the firebase-functions/logger
  // adapter still emits, and the LD adapter falls back to a no-op span.
  const sdkKey = process.env['LD_SDK_KEY'];
  if (!sdkKey) return;
  initServerObservability(sdkKey);
}

export const matchOrCreateCanonFlow = ai.defineFlow(
  {
    name: 'matchOrCreateCanon',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => {
    ensureObservabilityInitialised();
    // Wait for LD to load its sampling config before opening the first span on
    // a cold start, otherwise the span is created with a stale "don't sample"
    // decision and gets dropped at end() time.
    await whenServerObservabilityReady();

    // Strip wire-only fields before they reach the domain.
    const { _trace, ...rest } = input;
    const cleanInput: MatchOrCreateInput = {
      rawName: rest.rawName,
      ...(rest.selectedAisleId !== undefined && { selectedAisleId: rest.selectedAisleId }),
      ...(rest.forceCreate !== undefined && { forceCreate: rest.forceCreate }),
    };

    // Trace context is extracted at the callable entrypoint (index.ts) and
    // installed as the active OTel context before this flow runs, so a plain
    // startSpan inherits the browser's trace via context.active().
    const parentSpan = startSpan(`canon.matchOrCreateCanon: ${cleanInput.rawName}`);

    try {
      const result = await matchOrCreate(cleanInput, buildMatchOrCreatePorts(parentSpan));
      parentSpan.setAttribute('canon.path', 'cf');
      if (result.kind === 'ok') {
        parentSpan.setAttribute('canon.outcome', result.value.decision);
        parentSpan.setAttribute('canon.result', result.value.item.name);
      } else {
        parentSpan.setAttribute('canon.error', result.error.kind);
      }
      return result;
    } finally {
      parentSpan.end();
      // Spans are buffered — flush before the Node process is paused.
      await flushServerObservability();
    }
  },
);
