// ── PostHog distributed-tracing span processor ─────────────────────────────────
// Ships APP-LEVEL spans to PostHog's distributed-tracing OTLP endpoint
// (`/i/v1/traces`) so a CF invocation renders as ONE coherent end-to-end trace —
// the canon-matching structural spans, their single-invocation parents, and the
// Genkit AI sub-tree — all correlated by trace_id to the AI generations the AI
// leg ships to `/i/v0/ai/otel` (#356 follow-up).
//
// SELECTIVE, not firehose (issue #362 follow-up): the first cut shipped EVERY
// finished span, which buried the app's traces under thousands of OTel
// auto-instrumentation spans (`fs realpathSync`, HTTP `POST`/`PUT`,
// `@google-cloud/firestore` `Batch.Commit`) — SDK internals the issue explicitly
// did NOT want as trace nodes. shouldShipDistributed() now keeps only spans we
// author (the `salt-cloud-functions` tracer scope) plus Genkit spans (`genkit:*`
// attributes, incl. the human-readable flow roots), and drops the rest. That also
// stops the exporter's own outbound POST (an HTTP-instrumentation span) from
// re-entering the stream.
//
// This runs ALONGSIDE aiOtlpSpanProcessor on the same Genkit-owned tracer
// provider: the AI leg forwards only genkit:* spans (remapped into PostHog's
// LLM-observability gen_ai.*/ai.* namespace) to the AI endpoint. The two
// endpoints stitch on shared trace/parent ids, so an AI span legitimately appears
// in both the LLM view (as $ai_generation) and the end-to-end trace view.
//
// The OTLP/JSON span shape and the per-span POST are SHARED with the AI leg via
// otlpWire.ts — only the endpoint path differs. We forward each kept span's name,
// ids, timing, kind and scalar attributes; Genkit's bulky `genkit:*` content
// attributes are stripped (the FULL prompt/completion rides the AI leg into the
// LLM view instead). The one exception: on model/embedder spans we attach a SHORT
// `ai.prompt.preview` / `ai.completion.preview` (≤200 chars, media redacted) so the
// end-to-end trace carries enough AI context to read at a glance — there is no
// consolidated AI+trace view, so the bare structural span had no readable context.
// Embedding and image RESPONSES are intentionally omitted (no readable text — see
// genkitCompletionPreview). The preview text is built by the SAME genkitContent.ts
// flattener the AI leg uses, so the media-redaction policy can't drift.
//
// Best-effort, never throws (CLAUDE.md Rule 10): a dropped span is always better
// than a thrown error in a hot path. No-ops entirely without POSTHOG_API_KEY.
// Per-span export (SimpleSpanProcessor-style) for the same reason as the AI leg —
// CF instances pause between invocations, so a batch timer would strand spans.

import {
  type Attribute,
  type OtlpSpan,
  type ReadableSpanLike,
  type SpanProcessorLike,
  SERVICE_NAME,
  DISTRIBUTED_OTLP_PATH,
  collectAttributes,
  postOtlpSpan,
  strAttr,
  toOtlpSpan,
} from './otlpWire.js';
import { genkitCompletionPreview, genkitPromptPreview } from './genkitContent.js';

// Genkit tags its AI flow/model/embedder spans with `genkit:*` attributes; the AI
// leg keys off the same prefix. The human-readable flow roots that
// setActiveSpanName renames (e.g. "Import recipe from …") ARE Genkit flow spans,
// so this prefix is also how we keep them.
const GENKIT_ATTR_PREFIX = 'genkit:';

/** True if the span carries any `genkit:*` attribute (a Genkit flow/AI span). */
function hasGenkitAttribute(span: ReadableSpanLike): boolean {
  for (const key of Object.keys(span.attributes ?? {})) {
    if (key.startsWith(GENKIT_ATTR_PREFIX)) return true;
  }
  return false;
}

/** The originating instrumentation scope name (OTel newer/1.x), if any. */
function instrumentationScopeName(span: ReadableSpanLike): string | undefined {
  return span.instrumentationScope?.name ?? span.instrumentationLibrary?.name ?? undefined;
}

/**
 * Decide whether a finished span belongs in the end-to-end (app) trace view.
 * Ship ONLY spans we author or that carry the AI sub-tree:
 *   - Genkit spans (any `genkit:*` attribute) — the flow/model/embedder spans,
 *     including the human-readable flow roots setActiveSpanName renames.
 *   - Our own structural/infra spans — created on the `salt-cloud-functions`
 *     tracer (startSpan in init.ts), so their instrumentation scope is
 *     SERVICE_NAME (e.g. `shoppingList.matchItem`, `canon.*`, `Firestore: …`).
 *
 * Everything else is auto-instrumentation noise — `fs realpathSync`/`readFileSync`
 * (@opentelemetry/instrumentation-fs), HTTP `POST`/`PUT`, `@google-cloud/firestore`
 * `Batch.Commit`/`DocumentReference.Update` — i.e. the SDK internals the issue
 * explicitly does NOT want as trace nodes; "ship every span" buried the app spans
 * under thousands of these. Dropping them also stops the exporter's own outbound
 * POST (an HTTP-instrumentation span) from re-entering the stream.
 */
export function shouldShipDistributed(span: ReadableSpanLike): boolean {
  return hasGenkitAttribute(span) || instrumentationScopeName(span) === SERVICE_NAME;
}

/** A Genkit model/embedder action span carries an extractable prompt/response. */
function genkitSubtype(attrs: Readonly<Record<string, unknown>>): string {
  const v = attrs['genkit:metadata:subtype'];
  return typeof v === 'string' ? v : '';
}

/**
 * Attach a short, media-redacted prompt/response preview on model & embedder
 * spans so the end-to-end trace has AI context at a glance (the full prompt/
 * completion rides the AI leg into the LLM view; there is no consolidated view).
 * Embedding and image RESPONSES yield no readable text and are omitted by
 * genkitCompletionPreview. The flattener is shared with the AI leg (genkitContent
 * .ts) so the never-forward-base64 policy can't drift.
 */
function appendContentPreviews(
  attrs: Readonly<Record<string, unknown>>,
  attributes: Attribute[],
): void {
  const subtype = genkitSubtype(attrs);
  if (subtype !== 'model' && subtype !== 'embedder') return;
  const prompt = genkitPromptPreview(attrs);
  if (prompt) attributes.push(strAttr('ai.prompt.preview', prompt));
  const completion = genkitCompletionPreview(attrs);
  if (completion) attributes.push(strAttr('ai.completion.preview', completion));
}

/**
 * Map a finished span to an OTLP span verbatim (no namespace remap). The encoding
 * and the envelope are the SHARED mechanism (src/shared/otlpWire.ts), identical to
 * the browser leg; what stays HERE is this leg's POLICY — Genkit's bulky
 * `genkit:input`/`genkit:output` blobs are dropped (they are the AI leg's concern,
 * which remaps + caps them into the LLM view), and model/embedder spans gain a
 * short content preview instead. Never returns null — the distributed endpoint
 * keeps every span it is handed.
 */
export function toDistributedOtlpSpan(span: ReadableSpanLike): OtlpSpan {
  const attrs = span.attributes ?? {};
  const attributes = collectAttributes(attrs, (key) => !key.startsWith(GENKIT_ATTR_PREFIX));
  // ...plus a short prompt/response preview on AI spans (see above).
  appendContentPreviews(attrs, attributes);
  return toOtlpSpan(span, attributes);
}

// ── Export pipeline ────────────────────────────────────────────────────────────

// Per-span export (SimpleSpanProcessor-style), mirroring the AI leg: each ended
// span POSTs immediately; the in-flight promise is tracked so
// flushServerObservability() can drain it before the function returns. PostHog
// stitches the tree by trace/parent id across the separate POSTs.
const inFlight = new Set<Promise<void>>();

function track(p: Promise<void>): void {
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
}

/** Await any in-flight distributed-trace span exports. Called from flushServerObservability(). */
export async function flushDistributedOtlp(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

/**
 * The span processor added to the Genkit-owned global provider (via
 * attachDistributedSpanProcessor), ALONGSIDE the AI processor. `onEnd` ships
 * EVERY finished span to the distributed endpoint; the other hooks are no-ops /
 * drains. Never throws.
 */
export const distributedSpanProcessor: SpanProcessorLike = {
  onStart(): void {
    // no-op — we only act on finished spans.
  },
  onEnd(span: ReadableSpanLike): void {
    try {
      if (!process.env['POSTHOG_API_KEY']) return;
      // Ship only app-level spans (Genkit + our own); drop auto-instrumentation
      // noise so the end-to-end view reads like the app, not SDK internals.
      if (!shouldShipDistributed(span)) return;
      track(postOtlpSpan(toDistributedOtlpSpan(span), DISTRIBUTED_OTLP_PATH));
    } catch {
      // Best-effort; a map/export failure must never propagate.
    }
  },
  async forceFlush(): Promise<void> {
    await flushDistributedOtlp();
  },
  async shutdown(): Promise<void> {
    await flushDistributedOtlp();
  },
};
