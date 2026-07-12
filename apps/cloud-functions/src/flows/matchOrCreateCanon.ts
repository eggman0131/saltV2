import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { matchOrCreate } from '@salt/domain';
import type { MatchOrCreateInput, MatchOrCreatePorts } from '@salt/domain';
import { MatchOrCreateCanonInputSchema } from '@salt/domain/schemas';
import {
  createServerObservabilityMatchLoggingAdapter,
  initServerObservability,
  isServerObservabilityInitialised,
  startSpan,
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
  // Both match-log sinks: firebase-functions/logger + PostHog. Built once here so
  // the fan-out port below reuses them across entries.
  const logSinks = [
    createServerMatchLoggingAdapter(),
    createServerObservabilityMatchLoggingAdapter(parentSpan),
  ];
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
    // Fan each entry to both sinks; allSettled so one sink's failure never blocks
    // the other.
    logging: {
      write: async (entry) => {
        await Promise.allSettled(logSinks.map((p) => p.write(entry)));
      },
    },
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
      // Span buffering is drained by the makeTracedCallable entrypoint's finally
      // flush (index.ts, issue #415) — the single, uniform flush point.
    }
  },
);
