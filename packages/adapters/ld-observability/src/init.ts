import { createClient, type LDClient, type LDContext } from '@launchdarkly/js-client-sdk';
import Observability from '@launchdarkly/observability';

let client: LDClient | null = null;

const ANON_CONTEXT: LDContext = { kind: 'user', key: 'anonymous', anonymous: true };

export function initLDObservability(clientSideId: string): void {
  if (client) return;
  // Observe from highlight.run satisfies the plugin interface at runtime but
  // doesn't align with LDPluginBase's generic shape — cast required.
  client = createClient(clientSideId, ANON_CONTEXT, { plugins: [new Observability() as never] });
  void client.start();
}

export function identifyObservabilityUser(uid: string, email?: string): void {
  void client?.identify({ kind: 'user', key: uid, email, anonymous: false });
}

export function identifyObservabilityAnonymous(): void {
  void client?.identify(ANON_CONTEXT);
}
