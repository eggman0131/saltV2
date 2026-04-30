import { LDRecord } from '@launchdarkly/session-replay';
import { trackObservabilityEvent } from './init.js';

export interface ObservabilitySessionMeta {
  readonly e2e: true;
  readonly testName: string;
  readonly testId: string;
  readonly runId: string;
  readonly branch: string;
  readonly ciJob?: string;
}

export function tagObservabilitySession(meta: ObservabilitySessionMeta): void {
  LDRecord.addSessionProperties({ ...meta });
  trackObservabilityEvent('e2e:start', meta);
}

export function getObservabilitySessionURL(): string | null {
  return LDRecord.getSession()?.url ?? null;
}
