import { LDRecord } from '@launchdarkly/session-replay';
import { isObservabilityReady, trackObservabilityEvent } from './init.js';

export interface ObservabilitySessionMeta {
  readonly e2e: true;
  readonly testName: string;
  readonly testId: string;
  readonly runId: string;
  readonly branch: string;
  readonly ciJob?: string;
}

export function tagObservabilitySession(meta: ObservabilitySessionMeta): void {
  // LDRecord throws before initLDObservability has wired the Record plugin; stay
  // inert when LD is uninitialised (e.g. gated off in the e2e build).
  if (!isObservabilityReady()) return;
  LDRecord.addSessionProperties({ ...meta });
  trackObservabilityEvent('e2e:start', meta);
}

export function getObservabilitySessionURL(): string | null {
  if (!isObservabilityReady()) return null;
  return LDRecord.getSession()?.url ?? null;
}
