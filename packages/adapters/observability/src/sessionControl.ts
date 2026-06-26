import { isObservabilityReady, safePosthog } from './init.js';

export function startObservabilitySession(name?: string): void {
  safePosthog((ph) => {
    if (name) {
      ph.register_for_session({
        devSessionName: name,
        devSessionStartedAt: new Date().toISOString(),
      });
    }
    ph.startSessionRecording();
  });
}

export function stopObservabilitySession(): void {
  safePosthog((ph) => ph.stopSessionRecording());
}

export function isObservabilitySessionActive(): boolean {
  if (!isObservabilityReady()) return false;
  let active = false;
  safePosthog((ph) => {
    active = ph.sessionRecordingStarted?.() ?? false;
  });
  return active;
}
