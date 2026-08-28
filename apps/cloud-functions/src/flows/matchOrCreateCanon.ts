import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { matchOrCreate, resolveProductForm } from '@salt/domain';
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
import { createFirestoreProductFormStore } from '../adapters/firestoreProductFormStore.js';
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

/**
 * Reads `productForms` and builds the "is this name a derivation" predicate the
 * synonym guard consults (`appendCanonSynonym`, issue #865/#866).
 *
 * Returns `undefined` — i.e. "no opinion", today's behaviour — when the read
 * fails or the table is empty. That degrade is required by Rule 10 and is the
 * documented domain default (`appendCanonSynonym.ts:18-28`): a caller that could
 * not read the forms must not escalate to refusing synonyms wholesale. It is
 * also the limit of the guarantee below, and is stated rather than glossed: while
 * a `productForms` read is failing, a derivation can still be written into a
 * synonym list, exactly as it could before this existed.
 *
 * An empty table is folded into the same branch for clarity, not for behaviour —
 * `resolveProductForm(name, [])` is always `null`, so a present-but-empty
 * predicate would answer `false` to everything anyway.
 */
async function buildDefaultDerivedNamePredicate(
  db: ReturnType<typeof getFirestore>,
): Promise<MatchOrCreatePorts['isDerivedName']> {
  const formsResult = await createFirestoreProductFormStore(db).list();
  if (formsResult.kind !== 'ok' || formsResult.value.length === 0) return undefined;
  const forms = formsResult.value;
  return (name: string) => resolveProductForm(name, forms) !== null;
}

export async function buildMatchOrCreatePorts(
  parentSpan?: ObservabilitySpan,
  // Distributed-trace correlation (issue #362, Phase 5). The shopping-list
  // trigger threads the browser-rooted W3C `traceparent` here so the canon
  // write-back stamps it as `traceContext` on the doc, letting the
  // onCanonItemWritten icon/embedding trigger continue the same trace. Optional:
  // the callable path passes nothing (its trace rides the request, not the doc).
  traceContext?: string,
  // An explicit override of the `isDerivedName` predicate this builder otherwise
  // reads for itself. The recipe-canonicalisation flow supplies one because its
  // `forms` array is MUTABLE — a form minted mid-batch must protect the next item
  // in the same recipe, which a snapshot taken here cannot do.
  //
  // Every entry point that builds its ports HERE now gets the guard by default
  // (issue #937). That covers the three server callers — the callable, the
  // shopping-list trigger and the recipe batch. It is not a claim about ports
  // built elsewhere: the browser fast path assembles its own bag in
  // `canonService.ts` and supplies its own predicate from the canon subscription.
  extras?: Pick<MatchOrCreatePorts, 'isDerivedName'>,
): Promise<MatchOrCreatePorts> {
  const db = getFirestore();
  // The override wins, and short-circuits the read: a caller that already holds
  // the forms should not pay a second collection read to be overruled.
  const isDerivedName = extras?.isDerivedName ?? (await buildDefaultDerivedNamePredicate(db));
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
    ...(isDerivedName !== undefined ? { isDerivedName } : {}),
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

    // Every field the wire schema declares, on the same conditional-spread
    // pattern. `rawText` was declared, typed by the client caller and consumed by
    // the arbitration prompt, but dropped here — the one entry point that
    // advertised it and threw it away (issue #937). No caller sends it yet, so
    // this closes a trap rather than fixing a live symptom.
    const cleanInput: MatchOrCreateInput = {
      rawName: input.rawName,
      ...(input.selectedAisleId !== undefined && { selectedAisleId: input.selectedAisleId }),
      ...(input.forceCreate !== undefined && { forceCreate: input.forceCreate }),
      ...(input.rawText !== undefined && { rawText: input.rawText }),
    };

    // Trace context is extracted at the callable entrypoint (index.ts) and
    // installed as the active OTel context before this flow runs, so a plain
    // startSpan inherits the inbound request trace via context.active().
    const parentSpan = startSpan(`canon.matchOrCreateCanon: ${cleanInput.rawName}`);

    try {
      const result = await matchOrCreate(cleanInput, await buildMatchOrCreatePorts(parentSpan));
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
