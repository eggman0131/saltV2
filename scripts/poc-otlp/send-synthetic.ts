/**
 * PoC: hand-built OTLP/JSON trace → PostHog AI OTLP ingestion endpoint.
 *
 * Issue:  #357 (Phase 1 probe), parent #356.
 *
 * WHY THIS EXISTS
 * ---------------
 * Production emits AI events to PostHog via the PostHog Node SDK fast-path
 * (`$ai_*` events posted directly). That path is well understood. What is NOT
 * yet understood is whether PostHog's *OTLP* AI-ingestion endpoint
 * (`/i/v0/ai/otel`) will:
 *
 *   (Q1) retain a span whose only AI-relevant signal is `ai.*` attributes
 *        (no `gen_ai.*`) and surface it as `$ai_span`;
 *   (Q2) reconstruct a full nested trace tree with our custom attributes
 *        visible on each span;
 *   (Q3) accept payloads on the EU region endpoint at all;
 *   (Q4) — deferred to Phase 2 — let us remap Genkit's native span shape.
 *
 * This script builds ONE trace of 5 spans by hand (we deliberately do NOT use
 * an OTel SDK / exporter — the raw OTLP/JSON wire shape is the thing under test)
 * and POSTs it. The orchestrator then verifies the result in PostHog and fills
 * in FINDINGS.md.
 *
 * NOTE: This PoC lives OUTSIDE the pnpm workspace (scripts/ is not matched by
 * pnpm-workspace.yaml), imports no `@salt/*` package, and uses Node built-ins
 * only (global `fetch`, `node:crypto`). Run with:
 *
 *   POSTHOG_PROJECT_KEY=phc_... pnpm exec tsx scripts/poc-otlp/send-synthetic.ts
 */

import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Config & auth
// ---------------------------------------------------------------------------

/** PostHog host. EU region by default; override with POSTHOG_HOST. */
const HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com';

/** PostHog AI OTLP ingestion endpoint. */
const ENDPOINT = `${HOST}/i/v0/ai/otel`;

/** Project API key (write key). Read from env — never hardcoded. */
const PROJECT_KEY = process.env.POSTHOG_PROJECT_KEY;

if (!PROJECT_KEY) {
  console.error(
    'ERROR: POSTHOG_PROJECT_KEY is not set.\n' +
      'Set it to your PostHog project API key and re-run, e.g.:\n' +
      '  POSTHOG_PROJECT_KEY=phc_xxx pnpm exec tsx scripts/poc-otlp/send-synthetic.ts',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// OTLP/JSON id + attribute helpers
// ---------------------------------------------------------------------------

/** 16 random bytes → 32 lowercase hex chars (OTLP trace id). */
function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** 8 random bytes → 16 lowercase hex chars (OTLP span id). */
function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

/** OTLP/JSON attribute value variants we use. */
type AttrValue =
  | { stringValue: string }
  | { intValue: string } // int64 is encoded as a string in OTLP/JSON
  | { boolValue: boolean }
  | { doubleValue: number };

interface Attribute {
  key: string;
  value: AttrValue;
}

const strAttr = (key: string, v: string): Attribute => ({ key, value: { stringValue: v } });
// int64 must be a string in OTLP/JSON to avoid JS number precision loss.
const intAttr = (key: string, v: number): Attribute => ({ key, value: { intValue: String(v) } });

// ---------------------------------------------------------------------------
// Span model
// ---------------------------------------------------------------------------

/** SPAN_KIND_INTERNAL — these are all in-process spans. */
const SPAN_KIND_INTERNAL = 1;

interface OtlpSpan {
  traceId: string;
  spanId: string;
  /** OMITTED entirely on the root span (no empty string). */
  parentSpanId?: string;
  name: string;
  kind: number;
  /** nanoseconds since epoch, as a string. */
  startTimeUnixNano: string;
  /** nanoseconds since epoch, as a string. */
  endTimeUnixNano: string;
  attributes: Attribute[];
}

/** Convert a millisecond epoch instant to an OTLP nanosecond string. */
const nanos = (ms: number): string => String(ms * 1_000_000);

// ---------------------------------------------------------------------------
// Build the trace: ONE traceId, 5 spans, correct parent chain.
//
//   extractRecipeFromUrl            (root, parent-less)            → $ai_trace
//   └─ canon.matchOrCreateCanon     (ai.* only, structural)       → $ai_span
//      ├─ generation (chat)         (gen_ai.* chat + tokens)      → $ai_generation
//      └─ embedding  (embeddings)   (gen_ai.* embeddings)         → $ai_embedding
//   └─ canon.dropped                (canon.* only, no ai/gen_ai)  → DROPPED (control)
// ---------------------------------------------------------------------------

const traceId = newTraceId();

const rootSpanId = newSpanId(); // span 1
const matchSpanId = newSpanId(); // span 2
const genSpanId = newSpanId(); // span 3
const embedSpanId = newSpanId(); // span 4
const droppedSpanId = newSpanId(); // span 5

// Time windows: root spans the whole thing; children nest inside it.
const t0 = Date.now();
const rootStart = t0;
const rootEnd = t0 + 900; // ~900ms total workflow

const matchStart = t0 + 50;
const matchEnd = t0 + 850;

const genStart = t0 + 100; // child of match, inside [matchStart, matchEnd]
const genEnd = t0 + 500;

const embedStart = t0 + 520; // child of match, inside [matchStart, matchEnd]
const embedEnd = t0 + 800;

const droppedStart = t0 + 860; // child of root, inside [rootStart, rootEnd]
const droppedEnd = t0 + 890;

// --- Span 1: ROOT — extractRecipeFromUrl --------------------------------------
// Parent-less root of the trace. Tagged with `ai.*` attributes plus a
// recognized-namespace operation name as a safety hedge for the open question
// of how a parent-less `ai.*` span is classified.
// EXPECT → $ai_trace (parent-less root), with ai.* attributes visible.
const rootSpan: OtlpSpan = {
  traceId,
  spanId: rootSpanId,
  // parentSpanId OMITTED — this is the root.
  name: 'extractRecipeFromUrl',
  kind: SPAN_KIND_INTERNAL,
  startTimeUnixNano: nanos(rootStart),
  endTimeUnixNano: nanos(rootEnd),
  attributes: [
    strAttr('ai.operation.name', 'workflow'),
    strAttr('ai.workflow.name', 'extractRecipeFromUrl'),
    strAttr('ai.input.url', 'https://example.com/recipes/poc'),
  ],
};

// --- Span 2: STRUCTURAL / namespace-trick — canon.matchOrCreateCanon ----------
// Child of root. Carries ONLY `ai.*` attributes (NO `gen_ai.*`). This is the
// crux test: does an `ai.*`-only structural span survive the AI-endpoint filter
// and surface its custom attributes? In production this represents the
// canon match/create step, which is structural rather than a model call.
// EXPECT → $ai_span retained, with its ai.* attributes visible.
const matchSpan: OtlpSpan = {
  traceId,
  spanId: matchSpanId,
  parentSpanId: rootSpanId,
  name: 'canon.matchOrCreateCanon',
  kind: SPAN_KIND_INTERNAL,
  startTimeUnixNano: nanos(matchStart),
  endTimeUnixNano: nanos(matchEnd),
  attributes: [
    strAttr('ai.operation.name', 'canon_match'),
    strAttr('ai.canon.outcome', 'matched'),
    strAttr('ai.canon.result', 'canon_poc_0001'),
  ],
};

// --- Span 3: GENERATION (chat) ------------------------------------------------
// Child of the match span. A real model call: gen_ai.operation.name = "chat"
// with response model + input/output token counts.
// EXPECT → $ai_generation with $ai_model + $ai_input_tokens/$ai_output_tokens.
const genSpan: OtlpSpan = {
  traceId,
  spanId: genSpanId,
  parentSpanId: matchSpanId,
  name: 'gemini.generate',
  kind: SPAN_KIND_INTERNAL,
  startTimeUnixNano: nanos(genStart),
  endTimeUnixNano: nanos(genEnd),
  attributes: [
    strAttr('gen_ai.operation.name', 'chat'),
    strAttr('gen_ai.response.model', 'gemini-2.5-flash'),
    intAttr('gen_ai.usage.input_tokens', 1234),
    intAttr('gen_ai.usage.output_tokens', 567),
  ],
};

// --- Span 4: EMBEDDING (embeddings) -------------------------------------------
// Child of the match span. An embeddings call:
// gen_ai.operation.name = "embeddings" with a request model.
// EXPECT → $ai_embedding (classified by the embeddings op name).
const embedSpan: OtlpSpan = {
  traceId,
  spanId: embedSpanId,
  parentSpanId: matchSpanId,
  name: 'gemini.embed',
  kind: SPAN_KIND_INTERNAL,
  startTimeUnixNano: nanos(embedStart),
  endTimeUnixNano: nanos(embedEnd),
  attributes: [
    strAttr('gen_ai.operation.name', 'embeddings'),
    strAttr('gen_ai.request.model', 'text-embedding-004'),
  ],
};

// --- Span 5: NEGATIVE CONTROL — canon.dropped --------------------------------
// Child of root. Carries ONLY `canon.*` attributes (NO `ai.*`, NO `gen_ai.*`).
// This proves the AI-endpoint filter is real: a span with no AI-namespace
// signal should be dropped server-side. Its presence/absence tells us whether
// the `ai.*` relabel on span 2 is what rescues it.
// EXPECT → DROPPED server-side (must NOT appear in PostHog).
const droppedSpan: OtlpSpan = {
  traceId,
  spanId: droppedSpanId,
  parentSpanId: rootSpanId,
  name: 'canon.dropped',
  kind: SPAN_KIND_INTERNAL,
  startTimeUnixNano: nanos(droppedStart),
  endTimeUnixNano: nanos(droppedEnd),
  attributes: [strAttr('canon.outcome', 'x'), strAttr('canon.note', 'should be dropped')],
};

const spans: OtlpSpan[] = [rootSpan, matchSpan, genSpan, embedSpan, droppedSpan];

// ---------------------------------------------------------------------------
// Assemble the OTLP/JSON body.
//
// resource.attributes carries service.name = "poc-otlp" so these synthetic
// events are filterable and deletable in PostHog.
// ---------------------------------------------------------------------------

const body = {
  resourceSpans: [
    {
      resource: {
        attributes: [strAttr('service.name', 'poc-otlp')],
      },
      scopeSpans: [
        {
          scope: { name: 'poc-otlp' },
          spans,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Print locating info BEFORE sending so the trace can be found in PostHog
  //    even if the POST output scrolls away.
  console.log('=== PoC OTLP → PostHog AI ingestion (#357) ===');
  console.log(`endpoint: ${ENDPOINT}`);
  console.log(`traceId:  ${traceId}`);
  console.log('spanIds:');
  console.log(`  1. root        extractRecipeFromUrl       → ${rootSpanId}   (expect $ai_trace)`);
  console.log(
    `  2. structural  canon.matchOrCreateCanon   → ${matchSpanId}   (expect $ai_span; ai.* only)`,
  );
  console.log(
    `  3. generation  gemini.generate (chat)     → ${genSpanId}   (expect $ai_generation)`,
  );
  console.log(
    `  4. embedding   gemini.embed (embeddings)  → ${embedSpanId}   (expect $ai_embedding)`,
  );
  console.log(`  5. control     canon.dropped              → ${droppedSpanId}   (expect DROPPED)`);
  console.log('');

  // 2. Print the full payload so the wire shape is auditable.
  console.log('--- OTLP/JSON payload ---');
  console.log(JSON.stringify(body, null, 2));
  console.log('');

  // 3. POST it.
  console.log(`POSTing to ${ENDPOINT} ...`);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PROJECT_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`HTTP status: ${res.status} ${res.statusText}`);
  console.log('--- response body ---');
  console.log(text);
  console.log('');

  // 4. Final one-line summary.
  console.log(`traceId=${traceId}  status=${res.status}`);
}

main().catch((err) => {
  console.error('Unexpected error while sending OTLP payload:');
  console.error(err);
  process.exit(1);
});
