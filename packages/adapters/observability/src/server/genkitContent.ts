// ── Genkit span content extraction (shared) ─────────────────────────────────────
// Turns a finished Genkit span's `genkit:input` / `genkit:output` JSON attributes
// into readable text. Shared by BOTH span-export legs so the content + media
// redaction policy can't drift between them — the same anti-drift rationale as
// otlpWire.ts (one wire schema for both legs):
//
//   - the AI leg (aiOtlpSpanProcessor) consumes the low-level primitives
//     (`parseJson`, `flattenParts`) to forward the FULL prompt + completion,
//     capped per message, into PostHog's LLM-observability view;
//   - the distributed leg (distributedSpanProcessor) consumes the high-level
//     `genkitPromptPreview` / `genkitCompletionPreview` to attach a SHORT
//     prompt/response preview so the end-to-end trace carries enough AI context
//     to read at a glance without leaving the trace view.
//
// Media parts (base64 data URIs — icon seeds + generated images) become a
// `[media]` placeholder in BOTH legs and are NEVER forwarded as bytes.

/** Parse a string attribute as JSON; `undefined` on a non-string or parse failure. */
export function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

/**
 * Flatten a Genkit `Part[]` (or string) to text. Media/binary parts become a
 * placeholder so base64 data URIs are never forwarded.
 */
export function flattenParts(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => {
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object') {
        const part = p as Record<string, unknown>;
        if (typeof part['text'] === 'string') return part['text'];
        if (part['media']) return '[media]';
        if (part['toolRequest']) return '[toolRequest]';
        if (part['toolResponse']) return '[toolResponse]';
        if (part['data'] !== undefined) return '[data]';
      }
      return '';
    })
    .join('');
}

// ── Preview helpers (distributed/end-to-end trace view) ─────────────────────────

// Default preview cap — enough to give context at a glance without re-shipping the
// bulky payload the AI leg already carries in full.
export const PREVIEW_MAX_CHARS = 200;

// Output that is only placeholders (e.g. an image generation's `[media]` response,
// or a bare tool echo) carries no readable text. genkitCompletionPreview treats it
// as "no completion", so IMAGE responses (media only) — which the maintainer
// flagged as meaningless in the trace view — are dropped. EMBEDDING responses are
// dropped earlier: their `genkit:output` has no message/candidates at all.
const PLACEHOLDER_RE = /\[(media|data|toolRequest|toolResponse)\]/g;
function hasReadableText(s: string): boolean {
  return s.replace(PLACEHOLDER_RE, '').trim().length > 0;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** A Genkit message (`{ role, content }`) or embedder doc (`{ content }`/`{ text }`/string) → text. */
function itemText(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    if (o['content'] !== undefined) return flattenParts(o['content']);
    if (typeof o['text'] === 'string') return o['text'];
  }
  return '';
}

function joinItems(items: unknown[]): string {
  return items
    .map(itemText)
    .filter((t) => t.length > 0)
    .join('\n');
}

/**
 * Short preview of a generation/embedder span's PROMPT (`genkit:input`). Handles
 * the model shape (`{ messages: Message[] }`), the embedder shape
 * (`{ input: Doc[] | string }`), and bare arrays/strings. Empty when there is no
 * usable input. Media is redacted via `flattenParts` (never base64 bytes).
 */
export function genkitPromptPreview(
  attrs: Readonly<Record<string, unknown>>,
  maxChars: number = PREVIEW_MAX_CHARS,
): string {
  const raw = parseJson(attrs['genkit:input']);
  if (raw == null) return '';
  if (typeof raw === 'string') return clip(raw, maxChars);
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o['messages']))
      items = o['messages']; // model: GenerateRequest.messages
    else if (Array.isArray(o['input']))
      items = o['input']; // embedder: documents
    else if (typeof o['input'] === 'string') return clip(o['input'], maxChars); // embedder: raw string
  }
  return clip(joinItems(items), maxChars);
}

/**
 * Short preview of a generation span's RESPONSE (`genkit:output`). Empty for
 * outputs with no readable text — i.e. EMBEDDING responses (vector only, no
 * message) and IMAGE responses (media only) — which the maintainer flagged as
 * meaningless in the trace view.
 */
export function genkitCompletionPreview(
  attrs: Readonly<Record<string, unknown>>,
  maxChars: number = PREVIEW_MAX_CHARS,
): string {
  const raw = parseJson(attrs['genkit:output']);
  if (!raw || typeof raw !== 'object') return '';
  const o = raw as Record<string, unknown>;
  let items: unknown[] = [];
  if (o['message']) items = [o['message']];
  else if (Array.isArray(o['candidates']))
    items = (o['candidates'] as Array<{ message?: unknown }>).map((c) => c?.message);
  else if (Array.isArray(o['messages'])) items = o['messages'];
  else return ''; // embeddings: { embeddings, usage } — no message to preview
  const text = joinItems(items);
  return hasReadableText(text) ? clip(text, maxChars) : '';
}
