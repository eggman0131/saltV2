// ── Server deployment environment (single source of truth) ──────────────────────
// The server-side `environment` dimension ('production' | 'staging' |
// 'development'), resolved by apps/cloud-functions/src/observability/environment.ts
// (resolveServerEnvironment) and handed to initServerObservability.
//
// It lives in its OWN leaf module — imported by BOTH init.ts (the writer, via the
// capture chokepoints) and otlpWire.ts (the reader, which stamps it onto every
// exported OTLP span resource) — so the span exporters can read the environment
// WITHOUT init.ts ↔ otlpWire.ts forming an import cycle (CLAUDE.md Rule 8 /
// dependency-cruiser no-circular). The module has no imports of its own.
//
// undefined until init, or when the caller omits it, in which case nothing is
// attached and both the event captures and the span exports behave as before.
let serverEnvironment: string | undefined;

/**
 * Record the server environment at init. An empty/undefined value clears it (stays
 * inert), so an un-environmented run attaches nothing anywhere.
 */
export function setServerEnvironment(environment: string | undefined): void {
  serverEnvironment = environment || undefined;
}

/** The recorded server environment, or undefined before init / when omitted. */
export function getServerEnvironment(): string | undefined {
  return serverEnvironment;
}
