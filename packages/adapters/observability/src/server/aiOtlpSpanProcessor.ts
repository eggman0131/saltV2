// ── PostHog AI-OTLP span processor ────────────────────────────────────────────
// Ships Genkit's native OpenTelemetry spans to PostHog's AI ingestion endpoint
// (`/i/v0/ai/otel`) so AI calls render as a real nested trace in PostHog LLM
// observability — replacing the old flat, manually-emitted `$ai_generation`
// summary events (see #356). The data (model, tokens, latency, structure) is
// read from the spans Genkit already emits, so embeddings and streamed calls are
// covered for free.
//
// PostHog's AI endpoint maps OTel spans to `$ai_trace`/`$ai_span`/
// `$ai_generation`/`$ai_embedding` and reconstructs the tree by trace/parent id.
// Crucially it DROPS any span whose attributes don't start with a recognised
// namespace (`gen_ai.`/`ai.`/`llm.`/`traceloop.`), so every span we keep must
// carry an `ai.*`/`gen_ai.*` attribute (root + leaves alike). Genkit emits in its
// own `genkit:*` namespace, so a remap shim is required (`remapGenkitSpan`).
//
// Scope (this increment): AI-only. We forward spans that carry `genkit:*`
// attributes (Genkit's AI flow/model/embedder spans); spans without `genkit:*`
// (our `canon.*` structural span, auto-instrumented Firestore/HTTP) are dropped —
// non-AI + duplicate-AI for the end-to-end view go to a separate endpoint later.
//
// Best-effort, never throws (CLAUDE.md Rule 10): a dropped span is always better
// than a thrown error in an AI hot path. No-ops entirely without POSTHOG_API_KEY.
//
// Types for `ReadableSpan` / the processor shape are declared STRUCTURALLY (not
// imported from `@opentelemetry/sdk-trace-*`) so this package takes no new build
// dependency — the same structural-typing approach the server adapter already
// uses to avoid a build-time genkit dependency. The structural types + OTLP/JSON
// wire layer (attribute encoders, HrTime→nanos, body builder, per-span POST) are
// shared with the distributed exporter via otlpWire.ts, so the wire schema can't
// drift between the two legs.
import {
  type Attribute,
  type OtlpSpan,
  type ReadableSpanLike,
  type SpanProcessorLike,
  SPAN_KIND_INTERNAL,
  hrTimeToNanos,
  intAttr,
  parentSpanId,
  postOtlpSpan,
  strAttr,
} from './otlpWire.js';
// parseJson + flattenParts are shared with the distributed leg (genkitContent.ts)
// so the content/media-redaction policy can't drift between the two export legs.
import { flattenParts, parseJson } from './genkitContent.js';

export type { ReadableSpanLike, SpanProcessorLike, OtlpSpan };

// AI ingestion endpoint — the only thing that differs from the distributed leg.
const AI_OTLP_PATH = '/i/v0/ai/otel';

/** `googleai/gemini-2.5-flash` → `gemini-2.5-flash`; passthrough when no prefix. */
function stripModelPrefix(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

// The app requests models via `-latest` aliases (AI_MODEL_DEFAULTS, e.g.
// `gemini-flash-lite-latest`), which PostHog's pricing catalog doesn't reliably
// recognise → null/under-reported cost. The Gemini API reports the CONCRETE model
// it actually served as `modelVersion` on the raw response, which Genkit stores at
// `genkit:output.custom.modelVersion`. We emit THAT as `gen_ai.response.model` so
// cost reflects the real model — accurate and self-correcting when Google promotes
// a new default behind an alias (no hardcoded version map to go stale). Falls back
// to the requested id when the served version isn't present (e.g. fake model).
function servedModel(attrs: Readonly<Record<string, unknown>>, fallback: string): string {
  const out = parseJson(attrs['genkit:output']) as
    { custom?: { modelVersion?: unknown } } | undefined;
  const served = out?.custom?.modelVersion;
  return typeof served === 'string' && served ? served : fallback;
}

// Content-forwarding policy (#356, per maintainer decision): forward full
// prompt + completion for generations (data is family-shared; the prompt/output
// IS the debug value), but cap each message so a pathological prompt (e.g. a full
// recipe HTML page in extractRecipeFromUrl) can't ship hundreds of KB. Embedding
// inputs forward only a short preview — the full embedded text/vector is bulk with
// little debug value. Media parts (base64 data URIs — the icon seed + generated
// images) are NEVER forwarded; they become a `[media]` placeholder.
const GEN_CONTENT_MAX_CHARS = 50_000;
const EMBED_PREVIEW_CHARS = 80;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

// Genkit role → OpenAI/PostHog role (`model` → `assistant`; others passthrough).
function mapRole(role: unknown): string {
  if (role === 'model') return 'assistant';
  return typeof role === 'string' && role ? role : 'user';
}

function toMessages(items: unknown, forcedRole?: string): Array<{ role: string; content: string }> {
  if (!Array.isArray(items)) return [];
  return items
    .map((m) => {
      const msg = (m ?? {}) as Record<string, unknown>;
      return {
        role: forcedRole ?? mapRole(msg['role']),
        content: truncate(flattenParts(msg['content']), GEN_CONTENT_MAX_CHARS),
      };
    })
    .filter((m) => m.content.length > 0);
}

/** Model-span input prompt from `genkit:input` (GenerateRequest.messages). */
function inputMessages(attrs: Readonly<Record<string, unknown>>): Array<{
  role: string;
  content: string;
}> {
  const raw = parseJson(attrs['genkit:input']) as { messages?: unknown } | unknown[] | undefined;
  if (!raw) return [];
  const messages = Array.isArray((raw as { messages?: unknown }).messages)
    ? (raw as { messages: unknown[] }).messages
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  return toMessages(messages);
}

/** Model-span completion from `genkit:output` (GenerateResponse.message/candidates). */
function outputMessages(attrs: Readonly<Record<string, unknown>>): Array<{
  role: string;
  content: string;
}> {
  const raw = parseJson(attrs['genkit:output']) as Record<string, unknown> | undefined;
  if (!raw) return [];
  if (raw['message']) return toMessages([raw['message']], 'assistant');
  if (Array.isArray(raw['candidates'])) {
    return toMessages(
      (raw['candidates'] as Array<{ message?: unknown }>).map((c) => c?.message),
      'assistant',
    );
  }
  if (Array.isArray(raw['messages'])) return toMessages(raw['messages']);
  return [];
}

/** Short preview of what an embedder span embedded (`genkit:input`), capped. */
function embedInputPreview(attrs: Readonly<Record<string, unknown>>): string {
  const raw = parseJson(attrs['genkit:input']) as { input?: unknown } | unknown[] | undefined;
  const input = (raw as { input?: unknown })?.input ?? raw;
  let text = '';
  if (typeof input === 'string') {
    text = input;
  } else if (Array.isArray(input)) {
    text = input
      .map((doc) => {
        if (typeof doc === 'string') return doc;
        if (doc && typeof doc === 'object') {
          const d = doc as Record<string, unknown>;
          if (Array.isArray(d['content'])) return flattenParts(d['content']);
          if (typeof d['text'] === 'string') return d['text'];
        }
        return '';
      })
      .join(' ');
  }
  return text.slice(0, EMBED_PREVIEW_CHARS);
}

/**
 * Token usage from a model/embedder span's `genkit:output` JSON — tokens live at
 * `.usage.{input,output}Tokens`, the exact path Genkit's own google-cloud
 * telemetry reads (generate.js).
 */
function readUsage(attrs: Readonly<Record<string, unknown>>): {
  inputTokens?: number;
  outputTokens?: number;
} {
  const usage = (
    parseJson(attrs['genkit:output']) as { usage?: Record<string, unknown> } | undefined
  )?.usage;
  if (!usage || typeof usage !== 'object') return {};
  const out: { inputTokens?: number; outputTokens?: number } = {};
  if (typeof usage['inputTokens'] === 'number') out.inputTokens = usage['inputTokens'];
  if (typeof usage['outputTokens'] === 'number') out.outputTokens = usage['outputTokens'];
  return out;
}

/**
 * Remap a finished Genkit span to an OTLP span tagged in a PostHog-recognised
 * namespace, or `null` to drop it.
 *
 *  - model action (`genkit:type=action`, `genkit:metadata:subtype=model`)
 *      → `gen_ai.*` chat → `$ai_generation` (model + token counts)
 *  - embedder action (`subtype=embedder`)
 *      → `gen_ai.*` embeddings → `$ai_embedding`
 *  - any other `genkit:*` span (flow / step / util / action)
 *      → `ai.*` structural → `$ai_trace` (root, `genkit:isRoot`) / `$ai_span`
 *  - a span with NO `genkit:*` attribute (canon structural span, infra spans)
 *      → dropped (`null`)
 *
 * Content: generations forward the full prompt + completion (capped per message;
 * media → `[media]`, never base64); embeddings forward only a short input preview
 * (see the content-forwarding policy above). The OTLP span name is the canonical
 * `genkit:name`, NOT the live `span.name` (which `setActiveSpanName()` may have
 * rewritten with user descriptors) — keeps the trace tree's node labels clean.
 */
export function remapGenkitSpan(span: ReadableSpanLike): OtlpSpan | null {
  const attrs = span.attributes ?? {};
  const hasGenkit = Object.keys(attrs).some((k) => k.startsWith('genkit:'));
  if (!hasGenkit) return null; // AI-only: drop non-Genkit (canon/infra) spans.

  const type = typeof attrs['genkit:type'] === 'string' ? (attrs['genkit:type'] as string) : '';
  const subtype =
    typeof attrs['genkit:metadata:subtype'] === 'string'
      ? (attrs['genkit:metadata:subtype'] as string)
      : '';
  const isRoot = attrs['genkit:isRoot'] === true || attrs['genkit:isRoot'] === 'true';
  const state = typeof attrs['genkit:state'] === 'string' ? (attrs['genkit:state'] as string) : '';
  // Canonical, scrub-safe identifier — fall back to a generic name, never span.name.
  const genkitName =
    typeof attrs['genkit:name'] === 'string' && attrs['genkit:name']
      ? (attrs['genkit:name'] as string)
      : `genkit.${type || 'span'}`;

  let name: string;
  let attributes: Attribute[];

  if (type === 'action' && subtype === 'model') {
    const { inputTokens, outputTokens } = readUsage(attrs);
    const requested = stripModelPrefix(genkitName);
    name = genkitName;
    attributes = [
      strAttr('gen_ai.operation.name', 'chat'),
      strAttr('gen_ai.system', 'gemini'),
      // request = the alias we asked for; response = the concrete model that
      // actually served it (the cost key PostHog reads for $ai_model).
      strAttr('gen_ai.request.model', requested),
      strAttr('gen_ai.response.model', servedModel(attrs, requested)),
    ];
    if (inputTokens !== undefined)
      attributes.push(intAttr('gen_ai.usage.input_tokens', inputTokens));
    if (outputTokens !== undefined)
      attributes.push(intAttr('gen_ai.usage.output_tokens', outputTokens));
    if (state) attributes.push(strAttr('gen_ai.state', state));
    // Forward the prompt + completion (PostHog $ai_input / $ai_output_choices).
    const inMsgs = inputMessages(attrs);
    if (inMsgs.length) attributes.push(strAttr('gen_ai.input.messages', JSON.stringify(inMsgs)));
    const outMsgs = outputMessages(attrs);
    if (outMsgs.length) attributes.push(strAttr('gen_ai.output.messages', JSON.stringify(outMsgs)));
  } else if (type === 'action' && subtype === 'embedder') {
    const { inputTokens } = readUsage(attrs);
    const requested = stripModelPrefix(genkitName);
    name = genkitName;
    attributes = [
      strAttr('gen_ai.operation.name', 'embeddings'),
      strAttr('gen_ai.system', 'gemini'),
      strAttr('gen_ai.request.model', requested),
      strAttr('gen_ai.response.model', servedModel(attrs, requested)),
    ];
    if (inputTokens !== undefined)
      attributes.push(intAttr('gen_ai.usage.input_tokens', inputTokens));
    if (state) attributes.push(strAttr('gen_ai.state', state));
    // Embeddings forward only a short preview of what was embedded.
    const preview = embedInputPreview(attrs);
    if (preview) {
      attributes.push(
        strAttr('gen_ai.input.messages', JSON.stringify([{ role: 'user', content: preview }])),
      );
    }
  } else {
    // Flow / step / util / non-AI action — structural node in the trace tree.
    name = genkitName;
    attributes = [
      strAttr('ai.operation.name', isRoot ? 'workflow' : 'chain'),
      strAttr('ai.span.name', genkitName),
    ];
    if (state) attributes.push(strAttr('ai.state', state));
  }

  const ctx = span.spanContext();
  const out: OtlpSpan = {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    name,
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: hrTimeToNanos(span.startTime),
    endTimeUnixNano: hrTimeToNanos(span.endTime),
    attributes,
  };
  const parent = parentSpanId(span);
  if (parent) out.parentSpanId = parent; // omitted on root (no empty string)
  return out;
}

// ── Export pipeline ────────────────────────────────────────────────────────────

// Per-span export (SimpleSpanProcessor-style): CF instances pause between
// invocations, so a batch timer would strand spans (the same reasoning behind
// posthog-node's flushAt:1 in init.ts). Each ended span POSTs immediately; the
// in-flight promise is tracked so flushServerObservability() can drain it before
// the function returns. PostHog stitches the tree by trace/parent id across the
// separate POSTs, so one-span-per-request reconstructs correctly.
const inFlight = new Set<Promise<void>>();

function track(p: Promise<void>): void {
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
}

async function postSpan(otlpSpan: OtlpSpan): Promise<void> {
  // Shared OTLP body + POST (otlpWire.postOtlpSpan); the AI path is what makes
  // this the AI leg. No-ops without POSTHOG_API_KEY; never throws (Rule 10).
  await postOtlpSpan(otlpSpan, AI_OTLP_PATH);
}

/** Await any in-flight AI-trace span exports. Called from flushServerObservability(). */
export async function flushAiOtlp(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

/**
 * The span processor added to the Genkit-owned global provider (via
 * attachAiOtlpSpanProcessor). `onEnd` remaps + ships each Genkit AI span; the
 * other hooks are no-ops / drains. Never throws.
 */
export const aiOtlpSpanProcessor: SpanProcessorLike = {
  onStart(): void {
    // no-op — we only act on finished spans.
  },
  onEnd(span: ReadableSpanLike): void {
    try {
      if (!process.env['POSTHOG_API_KEY']) return;
      const otlp = remapGenkitSpan(span);
      if (!otlp) return;
      track(postSpan(otlp));
    } catch {
      // Best-effort; a remap/export failure must never propagate.
    }
  },
  async forceFlush(): Promise<void> {
    await flushAiOtlp();
  },
  async shutdown(): Promise<void> {
    await flushAiOtlp();
  },
};
