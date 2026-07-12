// ─── CF telemetry-readiness gate (issue #370) ─────────────────────────────────
//
// `enableFirebaseTelemetry()` (index.ts) brings up the OTel pipeline —
// the span provider, the global W3C trace-context propagator AND the async-hooks
// context manager — ASYNCHRONOUSLY, fire-and-forget (`void enableFirebaseTelemetry()
// .then(…)`; nothing awaits it).
// Until that init completes, `propagation.extract` has no real propagator, so
// `runWith{Supplied,Extracted}TraceContext` silently drops the supplied browser
// trace and the flow re-roots a fresh one (CLAUDE.md Rule 10 — a split trace, never
// a throw).
//
// A Firestore trigger that COLD-STARTS fires its handler the moment the event is
// delivered — frequently before that async init has finished — which is exactly
// why onCanonItemWritten's icon + embedding work split off into their own root
// traces while the warmer onShoppingListItemWrite (fires on every add) won the
// race and nested correctly. The triggers await this gate before extracting so the
// supplied browser trace is honoured even from a cold start.
//
// Test/CLI-safe by default: until index.ts ARMS this with the telemetry boot
// promise, `whenCfTelemetryReady()` resolves immediately — a unit test (or any CLI
// entry) that imports a trigger without booting index.ts never blocks.

// Up to this long for the OTel pipeline to come up on a cold start before we give
// up and run the handler anyway (degrading to a normal root trace). Generous next
// to the triggers' 180s/300s function timeouts, so correct tracing costs at most a
// few seconds on the first invocation of a fresh instance, never a stuck trigger.
export const CF_TELEMETRY_READY_TIMEOUT_MS = 10_000;

let armed = false;
let settled = false;
let readiness: Promise<void> = Promise.resolve();

/**
 * Called ONCE at CF module load (index.ts) with the `enableFirebaseTelemetry()`
 * boot promise (the `.then()` that also attaches the PostHog span processors).
 * Never rejects — a telemetry-init failure SETTLES readiness too, so a broken
 * pipeline degrades a trigger to a root trace instead of hanging it (Rule 10).
 */
export function armCfTelemetry(telemetryBoot: Promise<unknown>): void {
  armed = true;
  readiness = telemetryBoot.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
}

/**
 * Resolve once the OTel pipeline is live, or after `timeoutMs` so a slow/stuck
 * init degrades to a normal root trace rather than hanging the trigger (Rule 10).
 * Resolves immediately when telemetry was never armed (unit tests / CLI) or has
 * already settled (a warm instance — the common case after the first invocation).
 */
export function whenCfTelemetryReady(
  timeoutMs: number = CF_TELEMETRY_READY_TIMEOUT_MS,
): Promise<void> {
  if (!armed || settled) return Promise.resolve();
  return Promise.race([
    readiness,
    new Promise<void>((resolve) => {
      // unref so a still-pending fallback timer never holds the instance awake
      // after the handler returns (the readiness path usually wins well before it).
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    }),
  ]);
}
