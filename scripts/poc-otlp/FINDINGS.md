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
| Q4 | Is remapping Genkit's native span shape onto this OTLP/`$ai_*` mapping feasible? | — | _Phase 2_ |

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

- **Screenshot link** (LLM-analytics / trace view in PostHog): _TODO (maintainer): open the LLM observability → Traces view, search trace `dca7434d76b3e329802740c93c44c063` (filter `service.name = poc-otlp`), and attach a screenshot of the rendered nested tree here. The MCP query above already proves the structure programmatically; the screenshot is visual corroboration._

## Verdict

**🟢 GREENLIGHT (Phase 1) for [#356](https://github.com/eggman0131/salt/issues/356)'s single-pipeline / namespace-trick approach.** Every load-bearing assumption held:

- An `ai.*`-only structural (non-AI) span **survives** PostHog's AI-endpoint filter as `$ai_span` (Q1).
- The full `$ai_trace → $ai_span → $ai_generation/$ai_embedding` tree **reconstructs nested**, with custom `ai.*` attributes visible verbatim (Q2).
- The **EU** endpoint accepts OTLP/JSON (Q3).
- The AI filter is **real** (negative control dropped), and every span to be kept needs an `ai.*`/`gen_ai.*` attribute — a concrete constraint for the production remap.

Remaining gate: **Q4** (real-Genkit-span remap feasibility) — see Phase 2 below. The endpoint is still alpha ("ingestion endpoint may change before GA"), so treat the wire shape as not-yet-frozen.
