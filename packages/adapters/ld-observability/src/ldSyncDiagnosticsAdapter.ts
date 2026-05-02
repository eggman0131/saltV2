import { LDObserve } from '@launchdarkly/observability';
import type { SyncDiagnosticsPort, SyncTickEvent } from '@salt/domain';

export function createLDSyncDiagnosticsAdapter(): SyncDiagnosticsPort {
  return {
    syncTick(event: SyncTickEvent): void {
      LDObserve.startManualSpan('canon.syncTick', (span) => {
        span.setAttribute('sync.scope', event.scope);
        span.setAttribute('sync.cursor', event.cursor);
        span.setAttribute('sync.batch_size', event.batchSize);
        span.setAttribute('sync.duration_ms', event.durationMs);
        span.end();
      });
    },
  };
}
