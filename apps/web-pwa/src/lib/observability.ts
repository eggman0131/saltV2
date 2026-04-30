import {
  initLDObservability,
  identifyObservabilityUser,
  identifyObservabilityAnonymous,
} from '@salt/ld-observability';
import type { User } from '@salt/domain';

initLDObservability(import.meta.env.VITE_LD_CLIENT_SIDE_ID as string);

export function identifyUser(user: User): void {
  identifyObservabilityUser(user.uid, user.email ?? undefined);
}

export function identifyAnonymous(): void {
  identifyObservabilityAnonymous();
}
