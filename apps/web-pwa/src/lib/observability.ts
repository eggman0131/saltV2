import {
  initLDObservability,
  identifyObservabilityUser,
  identifyObservabilityAnonymous,
  tagObservabilitySession,
  getObservabilitySessionURL,
  type ObservabilitySessionMeta,
} from '@salt/ld-observability';
import type { User } from '@salt/domain';

initLDObservability(import.meta.env.VITE_LD_CLIENT_SIDE_ID as string);

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

export type { ObservabilitySessionMeta };
