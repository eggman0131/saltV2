import { LDRecord } from '@launchdarkly/session-replay';
import { isObservabilityReady } from './init.js';

export function startObservabilitySession(name?: string): void {
  // LDRecord throws before initLDObservability has wired the Record plugin; stay
  // inert when LD is uninitialised (e.g. gated off in the e2e build).
  if (!isObservabilityReady()) return;
  if (name) {
    LDRecord.addSessionProperties({
      devSessionName: name,
      devSessionStartedAt: new Date().toISOString(),
    });
  }
  void LDRecord.start({ forceNew: true });
}

export function stopObservabilitySession(): void {
  if (!isObservabilityReady()) return;
  LDRecord.stop();
}

export function isObservabilitySessionActive(): boolean {
  return isObservabilityReady() && LDRecord.getRecordingState() === 'Recording';
}
