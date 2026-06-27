// Resolves the deployment environment for server-side PostHog telemetry. The
// value is passed to initServerObservability and attached to every server event
// as the `environment` property — the server counterpart to the browser side,
// which derives the same value from Vite's build mode (import.meta.env.MODE).
//
// Kept in the SAME vocabulary as the browser ('production' | 'staging' |
// 'development') so the `environment` dimension is consistent across client and
// CF events in PostHog. Project ids come from .firebaserc.
const PROJECT_ENVIRONMENTS: Readonly<Record<string, string>> = {
  's2-prod-e46bd': 'production',
  's2-stage-ccb22': 'staging',
  'demo-salt': 'development',
};

// The Functions runtime exposes the active GCP project as GCLOUD_PROJECT (with
// GCP_PROJECT as an older fallback); the emulator additionally sets
// FUNCTIONS_EMULATOR. Resolution order:
//   1. Emulator run               → 'development' (regardless of project id).
//   2. Known project id           → its friendly name.
//   3. Unknown but present id      → the raw id (debuggable; never mislabelled).
//   4. No project id at all        → 'development' (local / unconfigured).
export function resolveServerEnvironment(): string {
  if (process.env['FUNCTIONS_EMULATOR'] === 'true') return 'development';
  const projectId = process.env['GCLOUD_PROJECT'] ?? process.env['GCP_PROJECT'] ?? '';
  // `projectId || 'development'` (not ??) so an empty/unset id — a falsy '' that
  // ?? would pass through — falls back to 'development'.
  return PROJECT_ENVIRONMENTS[projectId] ?? (projectId || 'development');
}
