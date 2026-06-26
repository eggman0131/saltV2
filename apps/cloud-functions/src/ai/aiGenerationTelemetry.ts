import { captureAiGeneration, type AiGenerationUsage } from '@salt/observability/server';

// Centralised $ai_generation emit for the Genkit AI flows. Keeps the per-flow
// call sites to a single wrapped expression so the flows stay readable while AI
// model / token / latency telemetry is collected uniformly (it wasn't collected
// before this phase). The emit itself is inert/never-throws (PostHog server
// adapter) so adding it to a hot path is safe.
//
// `run` returns the flow's real generate result unchanged — tracedGenerate is
// transparent: it times the call, runs it, emits one $ai_generation event
// (tagged isError on a throw) and returns the original value, so call sites keep
// reading `.output` / `.text` / `.media` off the result.

// Genkit's GenerateResponse exposes an optional `.usage` (GenerationUsage). We
// read it off the result structurally — without constraining the generic — so
// the result's own type (and its .output/.text/.media) flows through untouched.
function readUsage(result: unknown): AiGenerationUsage | undefined {
  const usage = (result as { usage?: unknown } | null | undefined)?.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const out: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  if (typeof u['inputTokens'] === 'number') out.inputTokens = u['inputTokens'];
  if (typeof u['outputTokens'] === 'number') out.outputTokens = u['outputTokens'];
  if (typeof u['totalTokens'] === 'number') out.totalTokens = u['totalTokens'];
  return out;
}

export async function tracedGenerate<T>(
  flow: string,
  model: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    const usage = readUsage(result);
    captureAiGeneration({
      flow,
      model,
      latencyMs: Date.now() - startedAt,
      ...(usage !== undefined && { usage }),
    });
    return result;
  } catch (err) {
    captureAiGeneration({ flow, model, latencyMs: Date.now() - startedAt, isError: true });
    throw err;
  }
}
