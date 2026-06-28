# PoC: PostHog AI OTLP ingestion probe — FINDINGS

**Purpose:** Determine whether PostHog's AI OTLP endpoint (`/i/v0/ai/otel`) retains
our structural `ai.*`-only spans, reconstructs the full nested trace tree with custom
attributes, and accepts payloads on the EU region — before committing to an OTLP-based
AI-observability approach.

Related issues: [#357](https://github.com/eggman0131/salt/issues/357) (this probe, Phase 1) · [#356](https://github.com/eggman0131/salt/issues/356) (parent).

## How to run

The script lives outside the pnpm workspace, has no npm deps, and imports no `@salt/*`
package. Run it from the main checkout with your PostHog **project API key** in the env:

```sh
POSTHOG_PROJECT_KEY=phc_xxx pnpm exec tsx scripts/poc-otlp/send-synthetic.ts
```

- Endpoint (EU, default): `https://eu.i.posthog.com/i/v0/ai/otel`
- Override the host with `POSTHOG_HOST=https://…` if probing a different region.
- The script prints the shared `traceId` and all 5 span ids **before** sending, then the
  full OTLP/JSON payload, the HTTP status + raw response body, and a final
  `traceId=<id>  status=<code>` summary line.

The 5 spans (one trace):

| # | Span name | Namespace signal | Expected classification |
|---|-----------|------------------|-------------------------|
| 1 | `extractRecipeFromUrl` (root, parent-less) | `ai.*` + `ai.operation.name=workflow` | `$ai_trace` |
| 2 | `canon.matchOrCreateCanon` (child of 1) | `ai.*` only (no `gen_ai.*`) | `$ai_span` (structural) |
| 3 | `gemini.generate` (child of 2) | `gen_ai.operation.name=chat` + model + tokens | `$ai_generation` |
| 4 | `gemini.embed` (child of 2) | `gen_ai.operation.name=embeddings` + model | `$ai_embedding` |
| 5 | `canon.dropped` (child of 1) | `canon.*` only (no `ai.*`/`gen_ai.*`) | DROPPED (control) |

## Results

Run on **2026-06-28** against `https://eu.i.posthog.com/i/v0/ai/otel` (Default project, id 210211).
Probe `traceId`: **`dca7434d76b3e329802740c93c44c063`**.

| # | Question | Expected | Result |
|---|----------|----------|--------|
| Q1 | Does an `ai.*`-only structural span (span 2) survive the AI-endpoint filter and surface as `$ai_span` with its custom `ai.*` attributes visible? | Retained as `$ai_span` | ✅ **YES** — `canon.matchOrCreateCanon` (only `ai.*` attrs, **no** `gen_ai.*`) was retained as `$ai_span`, nested under the root, with `ai.canon.outcome` / `ai.canon.result` / `ai.operation.name` all visible verbatim. The namespace trick works. |
| Q2 | Does the full nested tree (root → match → {generation, embedding}) reconstruct with parent/child links and custom attributes visible on each span? | Tree intact; attrs visible | ✅ **YES** — `$ai_parent_id` chain reconstructs exactly: `$ai_trace` → `$ai_span` → {`$ai_generation`, `$ai_embedding`}. Custom `ai.*` attributes preserved verbatim as event properties on each retained span. |
| Q3 | Does the EU endpoint (`eu.i.posthog.com/i/v0/ai/otel`) accept the payload? | HTTP 2xx, events appear | ✅ **YES** — `HTTP 200 OK`, response body `{}`; all 4 expected events queryable within ~2 min. |
| Q4 | Is remapping Genkit's native span shape onto this OTLP/`$ai_*` mapping feasible? | — | ✅ **YES** — a real `gemini-2.5-flash` Genkit call's captured span (native `genkit:*` only, **no** `gen_ai.*`) was remapped to `gen_ai.*` and landed as `$ai_generation` with the real model id + real token counts. See [Phase 2](#phase-2--real-genkit-span-remap-q4) below. |

### Per-span observed classification

(MCP query: `SELECT event, properties.$ai_span_id, properties.$ai_parent_id, properties.$ai_model, properties.$ai_input_tokens, properties.$ai_output_tokens FROM events WHERE properties.$ai_trace_id = '…' ORDER BY timestamp`)

| # | Span | Expected `$ai_*` type | Observed | Custom attrs visible? |
|---|------|-----------------------|----------|-----------------------|
| 1 | `extractRecipeFromUrl` | `$ai_trace` | ✅ `$ai_trace` (parent_id = None) | ✅ `ai.operation.name=workflow`, `ai.workflow.name=extractRecipeFromUrl`, `ai.input.url=https://example.com/recipes/poc` |
| 2 | `canon.matchOrCreateCanon` | `$ai_span` | ✅ `$ai_span` (parent = root) | ✅ `ai.operation.name=canon_match`, `ai.canon.outcome=matched`, `ai.canon.result=canon_poc_0001` |
| 3 | `gemini.generate` | `$ai_generation` (with `$ai_model`, input/output tokens) | ✅ `$ai_generation` (parent = span 2), `$ai_model=gemini-2.5-flash`, `$ai_input_tokens=1234`, `$ai_output_tokens=567` | n/a (mapped to `$ai_*`) |
| 4 | `gemini.embed` | `$ai_embedding` | ✅ `$ai_embedding` (parent = span 2), `$ai_model=text-embedding-004` | n/a (mapped to `$ai_*`) |

### Negative control

| Span | Expectation | Confirmed dropped? |
|------|-------------|--------------------|
| `canon.dropped` (`canon.*`-only, no `ai.*`/`gen_ai.*`) | DROPPED server-side — proves the AI filter is real and that the `ai.*` relabel is what rescues span 2 | ✅ **DROPPED** — only **4** of the 5 sent spans appear; the `canon.*`-only span is absent. The filter is real, and an `ai.*`/`gen_ai.*` signal is required to survive. |

> **Open-question answered:** parent-less alone is **not** enough to be kept as `$ai_trace`. The root survived because it carried `ai.*` attributes; the negative control (no recognized namespace) was dropped *despite* being a child of the root. So the production remap must put a recognized-namespace attribute (`ai.*`/`gen_ai.*`) on **every** span it wants to keep, root included.

## Evidence

- **Run traceId:** `dca7434d76b3e329802740c93c44c063`
- **HTTP status / response body:** `HTTP 200 OK` — body `{}` (EU endpoint).
- **MCP query output** (events for this `traceId`):

  ```
  event          | span_id          | parent_id        | span_name                | model              | in_tok | out_tok
  $ai_trace      | dcc4baaf0572f91f | None             | extractRecipeFromUrl     | None               | None   | None
  $ai_span       | 285ec18128acee11 | dcc4baaf0572f91f | canon.matchOrCreateCanon | None               | None   | None
  $ai_generation | cd2f93e6f53010ad | 285ec18128acee11 | gemini.generate          | gemini-2.5-flash   | 1234   | 567
  $ai_embedding  | 843d3080bc3143d3 | 285ec18128acee11 | gemini.embed             | text-embedding-004 | None   | None
  (canon.dropped — ABSENT, dropped server-side)

  Custom ai.* attrs on retained spans:
  $ai_trace : ai.operation.name=workflow,    ai.workflow.name=extractRecipeFromUrl, ai.input.url=https://example.com/recipes/poc
  $ai_span  : ai.operation.name=canon_match, ai.canon.outcome=matched,              ai.canon.result=canon_poc_0001
  ```

- **Screenshot** (LLM observability → Traces view): ✅ captured by maintainer 2026-06-28 for trace `7bae6f5b658720130a0a945d55d9ef91` — the rendered nested tree `genkitPocWorkflow` (TRACE) → `canon.matchOrCreateCanon` (SPAN) → `genkit.generate.remapped` (GENERATION, `gemini-2.5-flash`, 9→1 tokens) matches the MCP query exactly. Attach the image to PR #358. (Note: this is the LLM-trace view, not the general APM view — see Scope caveat.)

## Phase 2 — real Genkit span remap (Q4)

`scripts/poc-otlp/send-genkit.ts` runs **one real** `ai.generate` (`gemini-2.5-flash`, prompt → "pong") with the `@genkit-ai/google-genai` plugin and a local `GEMINI_API_KEY`. It registers an in-process OTel `NodeTracerProvider` + in-memory `SpanProcessor` **before** importing Genkit (dynamic import), captures Genkit's native model span, remaps it to `gen_ai.*`, and ships a fresh 3-span trace (synthetic `ai.*` root + structural parent, real remapped generation leaf) to the same EU endpoint. Deps installed ad-hoc via a self-contained `scripts/poc-otlp/package.json` (`npm`, outside the workspace; `node_modules`/lockfile git-ignored).

**Captured real Genkit model span** — name `googleai/gemini-2.5-flash`, attributes confirmed `genkit:*`-only with **no** `gen_ai.*`:
`genkit:type=action`, `genkit:metadata:subtype=model`, `genkit:name=googleai/gemini-2.5-flash`, `genkit:key=/model/googleai/gemini-2.5-flash`, `genkit:path=…`, `genkit:state=success`, plus full `genkit:input`/`genkit:output` JSON (the latter embeds `usageMetadata`). Tokens were read from `result.usage` (`inputTokens` / `outputTokens`).

**Remapped result** (trace `7bae6f5b658720130a0a945d55d9ef91`, verified by MCP):

```
event          | span_id          | parent_id        | span_name                | model            | in_tok | out_tok | genkit.source.span_name
$ai_trace      | 9fae2e17aa4cf190 | None             | genkitPocWorkflow        | None             | None   | None    | None
$ai_span       | e4f9a4c2445880e3 | 9fae2e17aa4cf190 | canon.matchOrCreateCanon | None             | None   | None    | None
$ai_generation | e9a413a74a5cd35a | e4f9a4c2445880e3 | genkit.generate.remapped | gemini-2.5-flash | 9      | 1       | googleai/gemini-2.5-flash
```

**Q4 result:** ✅ **feasible.** The real Genkit span carries usage/model under `genkit:name` + `genkit:output.usageMetadata` (and the SDK result's `result.usage`); a small remap shim onto `gen_ai.response.model` / `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` is sufficient for PostHog to classify it as `$ai_generation` with the correct `$ai_model` and token counts, nested under a synthetic `ai.*` structural parent. The `genkit:* → gen_ai.*` bridge is the only production work this requires.

## Verdict

**🟢 GREENLIGHT for [#356](https://github.com/eggman0131/salt/issues/356)'s single-pipeline / namespace-trick approach.** Every load-bearing assumption held — across both synthetic and real-Genkit evidence:

- An `ai.*`-only structural (non-AI) span **survives** PostHog's AI-endpoint filter as `$ai_span` (Q1).
- The full `$ai_trace → $ai_span → $ai_generation/$ai_embedding` tree **reconstructs nested**, with custom `ai.*` attributes visible verbatim (Q2).
- The **EU** endpoint accepts OTLP/JSON (Q3).
- A **real** Genkit model span remaps cleanly to `gen_ai.*` and lands as `$ai_generation` with real model + tokens (Q4) — the production remap is feasible, not just the synthetic case.
- The AI filter is **real** (negative control dropped): every span to be kept needs an `ai.*`/`gen_ai.*` attribute — a concrete constraint for the production remap (tag the root and structural parents too, not just model leaves).

**Caveat:** the endpoint is still **alpha** ("ingestion endpoint may change before GA"), so treat the OTLP wire shape as not-yet-frozen; revisit if behavior drifts. The unified tree is confined to the LLM-observability view — see **[Scope caveat](#scope-caveat--unified-within-the-llm-observability-view-not-across-posthogs-general-apm-tracing)** below; infra/APM spans are not included. **Follow-up checks** deferred from this probe: protobuf (vs JSON) encoding parity, and whether browser→CF trace unification needs a minted traceparent (out of scope here).

## Scope caveat — unified *within the LLM-observability view*, not across PostHog's general APM tracing

The reconstructed tree (confirmed by the maintainer screenshot of trace `7bae6f5b658720130a0a945d55d9ef91`: `genkitPocWorkflow` → `canon.matchOrCreateCanon` → `genkit.generate.remapped / gemini-2.5-flash`) renders in PostHog's **LLM observability → Traces** view, which is fed by the `$ai_*` event pipeline behind `/i/v0/ai/otel`. The non-AI step (`canon.matchOrCreateCanon`) appears there **only** because the `ai.*` namespace trick relabels it as an `$ai_span`.

That is a **separate product** from PostHog's general OpenTelemetry tracing/APM (`posthog.trace_spans`, the spans explorer, `query-apm-spans`) and from `logs` / `metrics`. **Verified 2026-06-28** against project 210211: both `posthog.trace_spans` and `logs` resolve to non-existent `*_distributed` tables — those data planes are **not provisioned** in this project, and the AI-OTLP endpoint does **not** dual-write to them. Consequences:

- **"Non-AI step" = application logic you choose to model** (canon match, parse, arbitrate) → ✅ unified in the AI view via `ai.*` structural spans. This is exactly what #356's single-pipeline approach delivers.
- **"Non-AI step" = auto-instrumented infrastructure span** (Firestore read, outbound HTTP, the platform request span) → ❌ not in the AI view, and `/i/v0/ai/otel` will not put it there. There is no single rendered tree spanning both products today.

**Implication for #356:** the single-pipeline / namespace-trick approach yields one unified trace **provided every step is hand-emitted as an `ai.*`/`gen_ai.*` span into the AI endpoint**. It does not absorb infra/APM spans. If unifying auto-captured infrastructure spans is *also* a goal, the path is the **dual-write** below — the ingestion is validated; the rendered distributed trace is gated on enabling PostHog's tracing product.

## Combined view — dual-write to `/i/v1/traces` (`send-distributed.ts`)

The way to also capture **non-AI infrastructure spans** (Firestore, HTTP, the platform request span) is to run **two exporters in parallel** over the same spans (one shared `traceId`):

| Exporter | Endpoint | Lands in | Carries |
|----------|----------|----------|---------|
| PostHog AI span processor | `/i/v0/ai/otel` | LLM observability (`$ai_*`) | AI + `ai.*`-modelled structural spans |
| Standard OTLP span exporter | `/i/v1/traces` | Distributed tracing (`posthog.trace_spans`) | the **full** trace, AI + non-AI |

`send-distributed.ts` demonstrates this with one hand-built trace (`root` + non-AI `firestore.query` + `ai.*` structural + `gen_ai.*` generation).

**Probed 2026-06-28 (project 210211):**

- ✅ `/i/v1/traces` **accepts** the full mixed AI + non-AI OTLP/JSON payload — `HTTP 200`, body `{}`.
- ✅ It is a **distinct sink**: a trace sent only to `/i/v1/traces` produced **zero** `$ai_*` events (no leakage into LLM observability). Clean product separation.
- ✅ The AI-view half of the dual-write still reconstructs the nested tree (verified for trace `0350cee7d80c2495cb493fc8ddc23c7a`: `$ai_trace` → `$ai_span` → `$ai_generation`/`gemini-2.5-flash`).
- ⛔ **Gate:** the spans sent to `/i/v1/traces` are **not queryable/visible** — `posthog.trace_spans` does **not exist** in this project (`information_schema` lists only `system.trace_reviews`, an LLM-review table; `logs` is cataloged but its distributed table isn't materialized). PostHog's **distributed-tracing/APM product is not enabled** on project 210211, so `/i/v1/traces` is effectively accept-and-drop until it is turned on.
- ⚠️ **Billing tradeoff** (as expected): once tracing is enabled, AI spans are ingested **twice** (once per endpoint) — counts toward both products' volume.

**To complete this verification:** enable PostHog's tracing product on the project, re-run `send-distributed.ts`, then confirm the **non-AI** `firestore.query` span appears in distributed tracing under the same `traceId`:

```sql
SELECT name, service_name, kind
FROM posthog.trace_spans
WHERE hex(tryBase64Decode(trace_id)) = '<TRACEID-UPPER>'
ORDER BY timestamp
```

**Verdict on the combined view:** the dual-write **architecture is mechanically valid and the AI half is proven**; realizing the full distributed (AI + infra) trace view is purely a **product-enablement** step on the PostHog side, not a technical blocker — and brings the documented double-ingestion cost.
