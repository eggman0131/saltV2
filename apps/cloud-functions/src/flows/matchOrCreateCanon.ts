import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { matchOrCreate } from '@salt/domain';
import type { MatchLoggingPort, MatchOrCreateInput, MatchOrCreatePorts } from '@salt/domain';
import { MatchOrCreateCanonInputSchema } from '@salt/domain/schemas';
import {
  createServerObservabilityMatchLoggingAdapter,
  flushServerObservability,
  initServerObservability,
  isServerObservabilityInitialised,
  startSpan,
  whenServerObservabilityReady,
  type ObservabilitySpan,
} from '@salt/observability/server';
import { ai } from '../genkit.js';
import { createFirestoreCanonStore } from '../adapters/firestoreCanonStore.js';
import { createFirestoreAisleStore } from '../adapters/firestoreAisleStore.js';
import { createServerEmbeddingAdapter } from '../adapters/serverEmbedding.js';
import { createServerArbitrationAdapter } from '../adapters/serverArbitration.js';
import { createServerMatchLoggingAdapter } from '../adapters/serverMatchLog.js';
import { resolveServerEnvironment } from '../observability/environment.js';

// Trace context is no longer piggy-backed on the payload. Server-side trace
// unification now happens at the callable entrypoint (index.ts), which extracts
// the inbound W3C trace context from the request headers and installs it as the
// active OTel context before this flow runs — so the wire input is exactly the
// domain input, with no _trace field to strip.
//
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

export function buildMatchOrCreatePorts(
  parentSpan?: ObservabilitySpan,
  // Distributed-trace correlation (issue #362, Phase 5). The shopping-list
  // trigger threads the browser-rooted W3C `traceparent` here so the canon
  // write-back stamps it as `traceContext` on the doc, letting the
  // onCanonItemWritten icon/embedding trigger continue the same trace. Optional:
  // the callable path passes nothing (its trace rides the request, not the doc).
  traceContext?: string,
): MatchOrCreatePorts {
  const db = getFirestore();
  return {
    // Thread the parent span so the canon-store Firestore spans (candidate
    // load, write-back) nest under canon.matchOrCreateCanon / the recipe batch
    // span instead of re-rooting — mirroring the match-logging adapter below.
    // traceContext rides through to the write-back so the icon trigger nests.
    store: createFirestoreCanonStore(db, parentSpan, traceContext),
    aisleStore: createFirestoreAisleStore(db),
    embedding: createServerEmbeddingAdapter(),
    arbitration: createServerArbitrationAdapter(),
    ids: { newCanonId: () => crypto.randomUUID(), newAisleId: () => crypto.randomUUID() },
    logging: composeMatchLogging(
      createServerMatchLoggingAdapter(),
      createServerObservabilityMatchLoggingAdapter(parentSpan),
    ),
  };
}

function ensureObservabilityInitialised(): void {
  if (isServerObservabilityInitialised()) return;
  // POSTHOG_API_KEY is bound on the matchOrCreateCanon callable's secrets list
  // in index.ts; index.ts also inits at module load. This lazy guard covers the
  // direct-flow paths that don't go through that module load (the shopping-list
  // trigger, tests). Absence means PostHog server telemetry is disabled for this
  // env (e.g. emulator without the secret) — initServerObservability no-ops on
  // an empty key, the firebase-functions/logger adapter still emits, and the
  // PostHog match adapter silently drops.
  initServerObservability(process.env['POSTHOG_API_KEY'] ?? '', resolveServerEnvironment());
}

export const matchOrCreateCanonFlow = ai.defineFlow(
  {
    name: 'matchOrCreateCanon',
    inputSchema: MatchOrCreateCanonInputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => {
    ensureObservabilityInitialised();
    // Retained for call-site parity with the previous LD adapter (which awaited
    // an SDK readiness handshake before the first span). posthog-node has no
    // such handshake, so this resolves immediately; kept so the flow body's
    // structure is unchanged.
    await whenServerObservabilityReady();

    const cleanInput: MatchOrCreateInput = {
      rawName: input.rawName,
      ...(input.selectedAisleId !== undefined && { selectedAisleId: input.selectedAisleId }),
      ...(input.forceCreate !== undefined && { forceCreate: input.forceCreate }),
    };

    // Trace context is extracted at the callable entrypoint (index.ts) and
    // installed as the active OTel context before this flow runs, so a plain
    // startSpan inherits the inbound request trace via context.active().
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
