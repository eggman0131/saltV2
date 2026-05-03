import {
  initLDObservability,
  identifyObservabilityUser,
  identifyObservabilityAnonymous,
  tagObservabilitySession,
  getObservabilitySessionURL,
  startObservabilitySession,
  stopObservabilitySession,
  isObservabilitySessionActive,
  type ObservabilitySessionMeta,
} from '@salt/ld-observability';
import type { User } from '@salt/domain';

const _ldKey = import.meta.env.VITE_LD_CLIENT_SIDE_ID as string | undefined;
if (_ldKey) initLDObservability(_ldKey, { manualStart: import.meta.env.DEV });

export function identifyUser(user: User): void {
  identifyObservabilityUser(user.uid, user.email ?? undefined);
}

export function identifyAnonymous(): void {
  identifyObservabilityAnonymous();
}

export function tagSession(meta: ObservabilitySessionMeta): void {
  tagObservabilitySession(meta);
}

export function getSessionURL(): string | null {
  return getObservabilitySessionURL();
}

export function startSession(name?: string): void {
  startObservabilitySession(name);
}

export function stopSession(): void {
  stopObservabilitySession();
}

export function isSessionActive(): boolean {
  return isObservabilitySessionActive();
}

export type { ObservabilitySessionMeta };
