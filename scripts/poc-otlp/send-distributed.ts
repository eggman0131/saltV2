/**
 * PoC (follow-up): the "send to both endpoints" combined-view probe.
 *
 * Issue: #357 follow-up, parent #356.
 *
 * WHY THIS EXISTS
 * ---------------
 * `send-synthetic.ts` / `send-genkit.ts` proved PostHog reconstructs a unified
 * tree in its **LLM-observability** view (the `$ai_*` pipeline behind
 * `/i/v0/ai/otel`). But that view is a *separate product* from PostHog's general
 * OpenTelemetry **distributed tracing / APM** (`posthog.trace_spans`). Non-AI
 * infrastructure spans (Firestore reads, outbound HTTP, the platform request
 * span) never reach the AI view, and the `ai.*` namespace trick only smuggles in
 * steps you hand-model.
 *
 * The proposed production shape (see #356 discussion) is to run TWO exporters in
 * parallel over the SAME spans:
 *
 *   PostHog AI span processor   → /i/v0/ai/otel   (rich AI analysis: $ai_* view)
 *   standard OTLP span exporter → /i/v1/traces    (full distributed trace: AI + non-AI)
 *
 * Same `traceId` in both → AI generations show in LLM observability AND the full
 * end-to-end trace (incl. non-AI spans) shows in distributed tracing.
 * Tradeoff: AI spans are ingested twice (once per endpoint) — billing/volume.
 *
 * This script demonstrates that dual-write with ONE hand-built trace:
 *   - the FULL trace (root + non-AI `firestore.query` + `gen_ai` generation) is
 *     POSTed to `/i/v1/traces`;
 *   - only the AI span(s) are POSTed (relabelled with the structural `ai.*`
 *     parent) to `/i/v0/ai/otel`.
 *
 * PREREQUISITE / KNOWN GATE (verified 2026-06-28 on project 210211):
 *   `/i/v1/traces` returns HTTP 200, but `posthog.trace_spans` does not exist in
 *   this project — PostHog's distributed-tracing product is NOT enabled, so the
 *   distributed spans have no queryable/visible home yet. Enable PostHog tracing
 *   on the project, then re-run and verify via `posthog.trace_spans` /
 *   `query-apm-spans` (anchor on the printed traceId).
 *
 * Node built-ins only (global `fetch`, `node:crypto`); no `@salt/*` imports; lives
 * outside the pnpm workspace. Run:
 *   POSTHOG_PROJECT_KEY=phc_... pnpm exec tsx scripts/poc-otlp/send-distributed.ts
 */

import { randomBytes } from 'node:crypto';

const HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com';
const AI_ENDPOINT = `${HOST}/i/v0/ai/otel`; // LLM observability ($ai_* view)
const TRACES_ENDPOINT = `${HOST}/i/v1/traces`; // general distributed tracing / APM

const PROJECT_KEY = process.env.POSTHOG_PROJECT_KEY;
if (!PROJECT_KEY) {
  console.error(
    'ERROR: POSTHOG_PROJECT_KEY is not set.\n' +
      '  POSTHOG_PROJECT_KEY=phc_xxx pnpm exec tsx scripts/poc-otlp/send-distributed.ts',
  );
  process.exit(1);
}

// --- OTLP/JSON helpers (same wire shape as send-synthetic.ts) ----------------
const newTraceId = () => randomBytes(16).toString('hex'); // 32 hex
const newSpanId = () => randomBytes(8).toString('hex'); // 16 hex
const nanos = (ms: number) => String(ms * 1_000_000);
type AttrValue = { stringValue: string } | { intValue: string };
const s = (key: string, v: string) => ({ key, value: { stringValue: v } as AttrValue });
const i = (key: string, v: number) => ({ key, value: { intValue: String(v) } as AttrValue });

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: { key: string; value: AttrValue }[];
}

const resourceSpans = (spans: OtlpSpan[]) => ({
  resourceSpans: [
    {
      resource: { attributes: [s('service.name', 'poc-otlp')] },
      scopeSpans: [{ scope: { name: 'poc-otlp' }, spans }],
    },
  ],
});

async function post(endpoint: string, body: unknown): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROJECT_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`POST ${endpoint} -> ${res.status} ${res.statusText}  body=${text || '{}'}`);
  return `${res.status}`;
}

// --- Build ONE trace: root + non-AI infra span + structural + AI generation --
const traceId = newTraceId();
const rootId = newSpanId();
const dbId = newSpanId(); // NON-AI infra span (no ai.*/gen_ai.*)
const structuralId = newSpanId(); // ai.* structural (for the AI view)
const genId = newSpanId(); // gen_ai.* generation
const t0 = Date.now();

// kind: 2 = SERVER, 3 = CLIENT, 1 = INTERNAL
const root: OtlpSpan = {
  traceId,
  spanId: rootId,
  name: 'cf.extractRecipeFromUrl',
  kind: 2,
  startTimeUnixNano: nanos(t0),
  endTimeUnixNano: nanos(t0 + 900),
  attributes: [s('http.route', '/extractRecipeFromUrl'), s('ai.operation.name', 'workflow')],
};
// Pure infrastructure span — NO ai.*/gen_ai.*. Belongs in distributed tracing,
// and is exactly what the AI endpoint drops (see send-synthetic.ts negative control).
const dbSpan: OtlpSpan = {
  traceId,
  spanId: dbId,
  parentSpanId: rootId,
  name: 'firestore.query',
  kind: 3,
  startTimeUnixNano: nanos(t0 + 40),
  endTimeUnixNano: nanos(t0 + 260),
  attributes: [
    s('db.system', 'firestore'),
    s('db.operation', 'query'),
    s('db.collection', 'canon'),
  ],
};
// ai.* structural parent (so the AI view nests the generation under a step).
const structural: OtlpSpan = {
  traceId,
  spanId: structuralId,
  parentSpanId: rootId,
  name: 'canon.matchOrCreateCanon',
  kind: 1,
  startTimeUnixNano: nanos(t0 + 280),
  endTimeUnixNano: nanos(t0 + 880),
  attributes: [s('ai.operation.name', 'canon_match'), s('ai.canon.outcome', 'matched')],
};
const generation: OtlpSpan = {
  traceId,
  spanId: genId,
  parentSpanId: structuralId,
  name: 'gemini.generate',
  kind: 1,
  startTimeUnixNano: nanos(t0 + 320),
  endTimeUnixNano: nanos(t0 + 820),
  attributes: [
    s('gen_ai.operation.name', 'chat'),
    s('gen_ai.response.model', 'gemini-2.5-flash'),
    i('gen_ai.usage.input_tokens', 11),
    i('gen_ai.usage.output_tokens', 22),
  ],
};

async function main(): Promise<void> {
  console.log('=== PoC: dual-write combined-view probe (#357 follow-up) ===');
  console.log(`traceId: ${traceId}`);
  console.log(`  root        cf.extractRecipeFromUrl  -> ${rootId}`);
  console.log(`  infra       firestore.query          -> ${dbId}   (non-AI; distributed only)`);
  console.log(`  structural  canon.matchOrCreateCanon -> ${structuralId}   (ai.*)`);
  console.log(`  generation  gemini.generate          -> ${genId}   (gen_ai.*)`);
  console.log('');

  // 1. FULL trace (incl. the non-AI firestore span) -> general distributed tracing.
  //    Expect every span, including firestore.query, to appear in posthog.trace_spans
  //    ONCE PostHog's tracing product is enabled (see PREREQUISITE above).
  console.log('--- distributed tracing: full trace (AI + non-AI) ---');
  const distStatus = await post(
    TRACES_ENDPOINT,
    resourceSpans([root, dbSpan, structural, generation]),
  );

  // 2. AI-relevant spans -> LLM observability ($ai_* view). The firestore span is
  //    intentionally omitted here (the AI filter would drop it anyway).
  console.log('--- LLM observability: AI spans only ---');
  const aiStatus = await post(AI_ENDPOINT, resourceSpans([root, structural, generation]));

  console.log('');
  console.log(`traceId=${traceId}  distributed=${distStatus}  ai=${aiStatus}`);
  console.log(
    'Verify distributed: SELECT name, service_name FROM posthog.trace_spans ' +
      `WHERE hex(tryBase64Decode(trace_id)) = '${traceId.toUpperCase()}'  ` +
      '(requires PostHog tracing product enabled).',
  );
  console.log(
    `Verify AI view: SELECT event FROM events WHERE properties.$ai_trace_id = '${traceId}'.`,
  );
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
