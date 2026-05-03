import { LDRecord } from '@launchdarkly/session-replay';

export function startObservabilitySession(name?: string): void {
  if (name) {
    LDRecord.addSessionProperties({
      devSessionName: name,
      devSessionStartedAt: new Date().toISOString(),
    });
  }
  void LDRecord.start({ forceNew: true });
}

export function stopObservabilitySession(): void {
  LDRecord.stop();
}

export function isObservabilitySessionActive(): boolean {
  return LDRecord.getRecordingState() === 'Recording';
}
