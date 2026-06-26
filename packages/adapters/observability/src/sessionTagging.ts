import { safePosthog, trackObservabilityEvent } from './init.js';

export interface ObservabilitySessionMeta {
  readonly e2e: true;
  readonly testName: string;
  readonly testId: string;
  readonly runId: string;
  readonly branch: string;
  readonly ciJob?: string;
}

// Attaches e2e metadata to the current session/person and emits a start event.
// safePosthog keeps this inert when PostHog is uninitialised (e.g. gated off in
// the e2e build) and swallows any SDK failure.
export function tagObservabilitySession(meta: ObservabilitySessionMeta): void {
  safePosthog((ph) => {
    // Register as session-scoped properties so they ride along on every event
    // and the replay, mirroring LDRecord.addSessionProperties.
    ph.register_for_session({ ...meta });
  });
  trackObservabilityEvent('e2e:start', { ...meta });
}

export function getObservabilitySessionURL(): string | null {
  let url: string | null = null;
  safePosthog((ph) => {
    url = ph.get_session_replay_url?.() ?? null;
  });
  return url;
}
