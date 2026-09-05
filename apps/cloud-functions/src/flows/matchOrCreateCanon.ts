import { z } from 'genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { matchOrCreate, resolveProductForm } from '@salt/domain';
import type { CanonLocalStorePort, MatchOrCreateInput, MatchOrCreatePorts } from '@salt/domain';
import {
  MatchOrCreateCanonInputSchema,
  MatchOrCreateCanonOutputSchema,
} from '@salt/domain/schemas';
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
import { reportServerError } from '../observability/reportServerError.js';

// Trace context is no longer piggy-backed on the payload. Server-side trace
// unification now happens at the callable entrypoint (index.ts), which extracts
// the inbound W3C trace context from the request headers and installs it as the
// active OTel context before this flow runs — so the wire input is exactly the
// domain input, with no _trace field to strip.
//
// Stable message for the PostHog report below. A constant rather than an inline
// literal because its stability IS the feature: PostHog Error Tracking groups by
// message, so one recurring operational condition stays one issue. The original
// throw cannot be carried — `firestoreProductFormStore.classify` discards it, as
// its two sibling stores do (issue #1117, Open Questions).
const PRODUCT_FORMS_READ_FAILED = 'productForms read failed — derived-name synonym guard disabled';

/**
 * Reads `productForms` (and, since issue #1180, `canonItems`) and builds the
 * "is this name a derivation" predicate the synonym guard consults
 * (`appendCanonSynonym`, issue #865/#866).
 *
 * Returns `undefined` — i.e. "no opinion", today's behaviour — when the read
 * fails or the table is empty. That degrade is required by Rule 10 and is the
 * documented domain default (`appendCanonSynonym.ts:18-28`): a caller that could
 * not read the forms must not escalate to refusing synonyms wholesale. It is
 * also the limit of the guarantee below, and is stated rather than glossed: while
 * a `productForms` read is failing, a derivation can still be written into a
 * synonym list, exactly as it could before this existed.
 *
 * That limit is now ANNOUNCED rather than merely documented (issue #1117): a
 * failed read emits a `firebase-functions/logger` line and a `StorageError`
 * report, so the window in which the guard was off is recoverable afterwards from
 * Cloud Logging, and from PostHog wherever server observability is initialised
 * (an emulator with no POSTHOG_API_KEY drops it — the logger line is the half
 * that always lands).
 *
 * It is a signal, not a gate, stated as precisely as it holds: the value returned
 * on a failed read is unchanged (`undefined`), and no refusal, retry or throw path
 * was added. The two emitters are the house's non-throwing pair —
 * `reportServerError` swallows by contract (Rule 10), and `logger.warn` is used
 * exactly this way in the degrade paths of this flow's neighbours.
 *
 * Two things the signal does NOT cover, so nobody reads more into it: a bad
 * synonym written during the window persists after the read recovers and nothing
 * here retracts it; and this announces the read THIS function performs, not the
 * recipe batch's own read (announced separately at its own site) or the browser
 * fast path's unrelated no-opinion window.
 *
 * The two states are deliberately NOT folded together any more. An empty table is
 * a normal state (fresh environment, emulator) and stays silent;
 * `resolveProductForm(name, [], canon)` is always `null`, so a present-but-empty
 * predicate would answer `false` to everything anyway.
 */
async function buildDefaultDerivedNamePredicate(
  db: ReturnType<typeof getFirestore>,
  // The SAME store `buildMatchOrCreatePorts` is about to hand `matchOrCreate` as
  // `ports.store` — see `withMemoizedList` below (#1196). Passed in rather than
  // built here so this function's own canon read and `matchOrCreateBatch`'s
  // classification read share one Firestore query instead of two.
  canonStore: CanonLocalStorePort,
): Promise<MatchOrCreatePorts['isDerivedName']> {
  const formsResult = await createFirestoreProductFormStore(db).list();
  if (formsResult.kind !== 'ok') {
    logger.warn(`matchOrCreateCanon: ${PRODUCT_FORMS_READ_FAILED}`, { error: formsResult.error });
    reportServerError(new Error(PRODUCT_FORMS_READ_FAILED), 'StorageError');
    return undefined;
  }
  if (formsResult.value.length === 0) return undefined;
  const forms = formsResult.value;
  // The canon list `resolveProductForm`'s contested-phrase rule consults (issue
  // #1180). Read only once there is a non-empty forms table to consult it for,
  // so the no-forms environments that short-circuit above pay nothing — and even
  // then it costs nothing extra: `matchOrCreateBatch` reads this same canon list
  // for its own classification, so this trigger of the memoized read is simply
  // whichever of the two happens first.
  //
  // Its own degrade is SILENT and deliberately unlike the forms read's: a failed
  // canon read leaves the list empty, the contested rule inert, and the
  // predicate exactly as accurate as it was before #1180 — no guarantee is lost,
  // so there is no window to announce (Rule 10). A failed FORMS read is
  // different in kind, which is why it keeps its logger + PostHog pair above.
  const canonResult = await canonStore.list();
  const canon = canonResult.kind === 'ok' ? canonResult.value : [];
  return (name: string) => resolveProductForm(name, forms, canon) !== null;
}

/**
 * Memoizes `.list()` on a request-scoped `CanonLocalStorePort` (issue #1196).
 * Without this, `buildDefaultDerivedNamePredicate`'s contested-phrase check and
 * `matchOrCreateBatch`'s own classification read each ran a full canon
 * collection read on every single-item add — two reads of the same,
 * unchanging-within-the-request table. Every other method passes through
 * untouched: nothing here caches a write, and the memo is discarded with the
 * wrapper — it is never shared across two different requests.
 */
function withMemoizedList(store: CanonLocalStorePort): CanonLocalStorePort {
  let cached: ReturnType<CanonLocalStorePort['list']> | null = null;
  return {
    ...store,
    list: () => (cached ??= store.list()),
  };
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
  let store: CanonLocalStorePort = createFirestoreCanonStore(db, parentSpan, traceContext);
  // The override wins, and short-circuits the read: a caller that already holds
  // the forms should not pay a second collection read to be overruled.
  let isDerivedName = extras?.isDerivedName;
  if (isDerivedName === undefined) {
    // Only THIS path pays for a second canon read — the predicate's own
    // contested-phrase check, on top of `matchOrCreateBatch`'s classification
    // read below (#1196). So only it gets `withMemoizedList`: memoizing
    // unconditionally would go stale for a caller like the recipe batch, which
    // calls `matchOrCreateBatch` more than once against the SAME `ports` object
    // and writes new canon items between those calls — a memoized `.list()`
    // would hide them from the second call. That caller always supplies its own
    // `extras.isDerivedName`, so it never reaches this branch.
    const memoizedStore = withMemoizedList(store);
    isDerivedName = await buildDefaultDerivedNamePredicate(db, memoizedStore);
    store = memoizedStore;
  }
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
    store,
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
    outputSchema: MatchOrCreateCanonOutputSchema,
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
