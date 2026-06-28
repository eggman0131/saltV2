/**
 * PoC Phase 2: REAL Genkit model span → remap to `gen_ai.*` → PostHog AI OTLP.
 *
 * Issue:  #357 (Phase 2 — Q4), parent #356.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 1 (send-synthetic.ts) proved PostHog's OTLP AI-ingestion endpoint
 * (`/i/v0/ai/otel`) classifies HAND-BUILT spans correctly (`ai.*` → $ai_span /
 * $ai_trace, `gen_ai.*` chat → $ai_generation). That used SYNTHETIC token
 * counts and a hardcoded model id.
 *
 * Phase 2 closes the remaining open question (Q4): can a span emitted by a REAL
 * Genkit `ai.generate` call — whose native attribute namespace is `genkit:*`
 * (NOT `gen_ai.*`) — be remapped into the `gen_ai.*` shape and land in PostHog
 * as a correctly-attributed `$ai_generation` carrying the REAL model id and the
 * REAL token counts? This confirms the production remap (`genkit:* → gen_ai.*`)
 * is feasible against actual Genkit output, not just synthetic data.
 *
 * APPROACH
 * --------
 *   1. Register an in-process OTel SpanProcessor (NodeTracerProvider) BEFORE
 *      Genkit runs, so Genkit's internal spans flow to it and we can inspect the
 *      native `genkit:*` shape. We capture in-process ONLY — no GCP / Firebase
 *      exporter.
 *   2. Run ONE real `ai.generate` with gemini-2.5-flash and a tiny prompt.
 *   3. Locate the captured Genkit model span and log its native `genkit:*`
 *      attributes (evidence we remapped a REAL span, not synthetic data).
 *   4. Build a fresh OTLP/JSON trace (new traceId) with 3 spans mirroring the
 *      production shape: synthetic root (ai.*), synthetic structural child
 *      (ai.*), and the REMAPPED real generation (gen_ai.* with the REAL model id
 *      + REAL token counts from `result.usage`).
 *   5. POST to PostHog's AI OTLP endpoint with service.name=poc-otlp.
 *
 * NOTE: This PoC lives OUTSIDE the pnpm workspace and is SELF-CONTAINED: it has
 * its own scripts/poc-otlp/package.json + node_modules (installed with `npm`,
 * NOT pnpm) and imports NO `@salt/*` package. It deliberately does NOT touch the
 * production Genkit provider, `tracedGenerate`, or `enableFirebaseTelemetry` —
 * it is a disposable mirror. Run with:
 *
 *   GEMINI_API_KEY=AIza... POSTHOG_PROJECT_KEY=phc_... \
 *     ./node_modules/.bin/tsx send-genkit.ts
 */

import { randomBytes } from 'node:crypto';
import {
  NodeTracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node';

// ---------------------------------------------------------------------------
// Config & auth
// ---------------------------------------------------------------------------

/** PostHog host. EU region by default; override with POSTHOG_HOST. */
const HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com';

/** PostHog AI OTLP ingestion endpoint. */
const ENDPOINT = `${HOST}/i/v0/ai/otel`;

/** Project API key (publishable / write key). Read from env — never hardcoded. */
const PROJECT_KEY = process.env.POSTHOG_PROJECT_KEY;

if (!PROJECT_KEY) {
  console.error(
    'ERROR: POSTHOG_PROJECT_KEY is not set.\n' +
      'Set it to your PostHog project API key and re-run, e.g.:\n' +
      '  GEMINI_API_KEY=AIza... POSTHOG_PROJECT_KEY=phc_xxx ./node_modules/.bin/tsx send-genkit.ts',
  );
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.error(
    'ERROR: GEMINI_API_KEY is not set.\n' +
      'The googleAI plugin reads it from the environment; a real generate call needs it.',
  );
  process.exit(1);
}

/** The model under test. Mirrors the production canon-match generation model. */
const MODEL_ID = 'gemini-2.5-flash';

// ---------------------------------------------------------------------------
// Step 1: in-process OTel SpanProcessor — register BEFORE Genkit runs.
//
// We collect every finished span into an in-memory array via a custom
// SpanProcessor.onEnd. No exporter is attached — capture is in-process only, so
// nothing leaves the box except our own deliberate OTLP POST at the end.
// ---------------------------------------------------------------------------

const capturedSpans: ReadableSpan[] = [];

class InMemorySpanProcessor implements SpanProcessor {
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  onStart(): void {
    // no-op
  }
  onEnd(span: ReadableSpan): void {
    capturedSpans.push(span);
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

// Register the provider globally BEFORE importing/using Genkit so Genkit's
// internal tracer resolves to ours and its spans flow to onEnd().
const provider = new NodeTracerProvider({
  spanProcessors: [new InMemorySpanProcessor()],
});
provider.register();

// ---------------------------------------------------------------------------
// OTLP/JSON id + attribute helpers (mirror Phase 1's wire conventions).
// ---------------------------------------------------------------------------

/** 16 random bytes → 32 lowercase hex chars (OTLP trace id). */
function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** 8 random bytes → 16 lowercase hex chars (OTLP span id). */
function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

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

const SPAN_KIND_INTERNAL = 1;

interface OtlpSpan {
  traceId: string;
  spanId: string;
  /** OMITTED entirely on the root span (no empty string). */
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Attribute[];
}

/** Convert a millisecond epoch instant to an OTLP nanosecond string. */
const nanos = (ms: number): string => String(ms * 1_000_000);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== PoC Phase 2: REAL Genkit span → gen_ai.* remap → PostHog (#357 Q4) ===');
  console.log(`endpoint: ${ENDPOINT}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Step 2: run ONE real Genkit generation.
  //
  // Genkit is imported dynamically AFTER provider.register() so that any tracer
  // resolution inside Genkit/plugin init picks up our registered provider.
  // -------------------------------------------------------------------------
  const { genkit } = await import('genkit');
  const { googleAI } = await import('@genkit-ai/google-genai');

  const ai = genkit({ plugins: [googleAI()] });

  console.log(`Running real ai.generate with ${MODEL_ID} ...`);
  const result = await ai.generate({
    model: googleAI.model(MODEL_ID),
    prompt: 'Reply with the single word: pong.',
  });

  // Force any pending spans through the processor before we inspect them.
  await provider.forceFlush();

  // -------------------------------------------------------------------------
  // Read the REAL model id + REAL token counts off the result.
  // -------------------------------------------------------------------------
  const usage = result.usage ?? {};
  const inputTokens = Number(usage.inputTokens ?? 0);
  const outputTokens = Number(usage.outputTokens ?? 0);
  const totalTokens = Number(usage.totalTokens ?? inputTokens + outputTokens);

  // The model id Genkit actually used. Prefer a span-reported model below if
  // present; otherwise fall back to the requested MODEL_ID.
  let realModelId = MODEL_ID;

  console.log('');
  console.log('--- REAL generation result ---');
  console.log(`  response text: ${JSON.stringify((result.text ?? '').trim())}`);
  console.log(`  real model id (requested): ${MODEL_ID}`);
  console.log(`  real input tokens:  ${inputTokens}`);
  console.log(`  real output tokens: ${outputTokens}`);
  console.log(`  real total tokens:  ${totalTokens}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Step 3: locate the captured Genkit model/generate span and log its native
  // `genkit:*` attributes. This is the evidence that we remapped a REAL span.
  // -------------------------------------------------------------------------
  const hasGenkitAttrs = (span: ReadableSpan): boolean =>
    Object.keys(span.attributes).some((k) => k.startsWith('genkit:'));

  const genkitSpans = capturedSpans.filter(hasGenkitAttrs);

  // Heuristic to pick the model/generate span: prefer one whose genkit:* attrs
  // mention a model or the 'action'/'generate' subtype; otherwise take the one
  // carrying the most genkit:* attributes.
  const scoreSpan = (span: ReadableSpan): number => {
    const entries = Object.entries(span.attributes);
    let score = entries.filter(([k]) => k.startsWith('genkit:')).length;
    for (const [k, v] of entries) {
      const val = String(v ?? '').toLowerCase();
      if (k === 'genkit:name' && (val.includes('generate') || val.includes(MODEL_ID))) score += 10;
      if (k === 'genkit:metadata:subtype' && val === 'model') score += 10;
      if (k.startsWith('genkit:') && val.includes(MODEL_ID)) score += 5;
    }
    return score;
  };

  const modelSpan =
    genkitSpans.length > 0
      ? [...genkitSpans].sort((a, b) => scoreSpan(b) - scoreSpan(a))[0]
      : undefined;

  console.log('--- captured spans summary ---');
  console.log(`  total captured spans: ${capturedSpans.length}`);
  console.log(`  spans carrying genkit:* attrs: ${genkitSpans.length}`);
  console.log(
    `  all captured span names: ${capturedSpans.map((s) => s.name).join(', ') || '(none)'}`,
  );
  console.log('');

  let sourceSpanName = '(no genkit:* span captured)';
  if (modelSpan) {
    sourceSpanName = modelSpan.name;
    console.log('--- REAL captured Genkit model span ---');
    console.log(`  span name: ${modelSpan.name}`);
    console.log('  genkit:* attributes:');
    const genkitAttrEntries = Object.entries(modelSpan.attributes)
      .filter(([k]) => k.startsWith('genkit:'))
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of genkitAttrEntries) {
      console.log(`    ${k} = ${JSON.stringify(v)}`);
    }

    // Try to source a real model id from the genkit:* attributes if present.
    for (const [k, v] of Object.entries(modelSpan.attributes)) {
      const val = String(v ?? '');
      if (
        (k === 'genkit:name' || k.startsWith('genkit:metadata:model') || k.includes('model')) &&
        val.includes('gemini')
      ) {
        realModelId = val.replace(/^.*\//, '');
        break;
      }
    }
  } else {
    console.log(
      '--- NOTE: no span carrying genkit:* attributes was captured ---\n' +
        '  Falling back to the requested model id + result.usage token counts for the remap.\n' +
        '  (This is acceptable per the task: model + tokens come from the real result either way.)',
    );
  }
  console.log('');
  console.log(`  → model id used for remap: ${realModelId}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Step 4: build a fresh OTLP/JSON trace remapping the real generation into
  // the production-shaped 3-span tree.
  //
  //   genkitPocWorkflow            (root, ai.* only)            → $ai_trace
  //   └─ canon_match (structural)  (ai.* only)                  → $ai_span
  //      └─ genkit.generate.remapped (gen_ai.* + REAL tokens)   → $ai_generation
  // -------------------------------------------------------------------------
  const traceId = newTraceId();
  const rootSpanId = newSpanId();
  const structuralSpanId = newSpanId();
  const genSpanId = newSpanId();

  const t0 = Date.now();
  const rootStart = t0;
  const rootEnd = t0 + 900;
  const structStart = t0 + 50;
  const structEnd = t0 + 850;
  const genStart = t0 + 100;
  const genEnd = t0 + 800;

  // --- Span 1: synthetic ROOT (ai.* only) → $ai_trace ---
  const rootSpan: OtlpSpan = {
    traceId,
    spanId: rootSpanId,
    name: 'genkitPocWorkflow',
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: nanos(rootStart),
    endTimeUnixNano: nanos(rootEnd),
    attributes: [
      strAttr('ai.operation.name', 'workflow'),
      strAttr('ai.workflow.name', 'genkitPocWorkflow'),
    ],
  };

  // --- Span 2: synthetic STRUCTURAL child (ai.* only) → $ai_span ---
  const structuralSpan: OtlpSpan = {
    traceId,
    spanId: structuralSpanId,
    parentSpanId: rootSpanId,
    name: 'canon.matchOrCreateCanon',
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: nanos(structStart),
    endTimeUnixNano: nanos(structEnd),
    attributes: [
      strAttr('ai.operation.name', 'canon_match'),
      strAttr('ai.canon.outcome', 'matched'),
    ],
  };

  // --- Span 3: REMAPPED real generation (gen_ai.* + REAL tokens) → $ai_generation ---
  const genSpan: OtlpSpan = {
    traceId,
    spanId: genSpanId,
    parentSpanId: structuralSpanId,
    name: 'genkit.generate.remapped',
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: nanos(genStart),
    endTimeUnixNano: nanos(genEnd),
    attributes: [
      strAttr('gen_ai.operation.name', 'chat'),
      strAttr('gen_ai.response.model', realModelId),
      intAttr('gen_ai.usage.input_tokens', inputTokens),
      intAttr('gen_ai.usage.output_tokens', outputTokens),
      // Provenance: the real Genkit span this generation was remapped from.
      strAttr('genkit.source.span_name', sourceSpanName),
    ],
  };

  const spans: OtlpSpan[] = [rootSpan, structuralSpan, genSpan];

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

  console.log('--- remapped gen_ai.* attributes (sent on genkit.generate.remapped) ---');
  for (const attr of genSpan.attributes) {
    console.log(`    ${attr.key} = ${JSON.stringify(attr.value)}`);
  }
  console.log('');

  console.log('--- new trace identity ---');
  console.log(`  traceId: ${traceId}`);
  console.log(`  span 1 (root, ai.* → $ai_trace):        ${rootSpanId}`);
  console.log(`  span 2 (structural, ai.* → $ai_span):   ${structuralSpanId}`);
  console.log(`  span 3 (remapped gen → $ai_generation): ${genSpanId}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Step 5: POST the OTLP/JSON to PostHog's AI ingestion endpoint.
  // -------------------------------------------------------------------------
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

  // Final one-line summary (matches Phase 1's format).
  console.log(`traceId=${traceId}  status=${res.status}`);

  await provider.shutdown();
}

main().catch((err) => {
  console.error('Unexpected error in send-genkit PoC:');
  console.error(err);
  process.exit(1);
});
