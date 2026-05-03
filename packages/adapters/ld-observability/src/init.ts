import { createClient, type LDClient, type LDContext } from '@launchdarkly/js-client-sdk';
import Observability from '@launchdarkly/observability';
import SessionReplay from '@launchdarkly/session-replay';

let client: LDClient | null = null;

const ANON_CONTEXT: LDContext = { kind: 'user', key: 'anonymous', anonymous: true };

export interface LDObservabilityOptions {
  manualStart?: boolean;
}

export function initLDObservability(clientSideId: string, opts?: LDObservabilityOptions): void {
  if (client) return;
  // Observe and Record from highlight.run satisfy the plugin interface at runtime
  // but don't align with LDPluginBase's generic shape — cast required.
  const replayOpts = opts?.manualStart ? { manualStart: true } : undefined;
  client = createClient(clientSideId, ANON_CONTEXT, {
    plugins: [new Observability() as never, new SessionReplay(replayOpts) as never],
  });
  void client.start();
}

export function identifyObservabilityUser(uid: string, email?: string): void {
  void client?.identify({ kind: 'user', key: uid, email, anonymous: false });
}

export function identifyObservabilityAnonymous(): void {
  void client?.identify(ANON_CONTEXT);
}

export function trackObservabilityEvent(key: string, data?: unknown): void {
  client?.track(key, data);
}
