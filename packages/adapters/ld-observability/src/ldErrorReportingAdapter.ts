import { LDObserve } from '@launchdarkly/observability';
import type { ErrorReportingPort } from '@salt/domain';
import { isObservabilityReady } from './init.js';

export function createLDErrorReportingAdapter(): ErrorReportingPort {
  return {
    report(error: unknown): void {
      // LDObserve.recordError() throws before initLDObservability has wired the
      // Observe plugin; drop the report rather than throw when LD is uninitialised.
      if (!isObservabilityReady()) return;
      const err = error instanceof Error ? error : new Error(String(error));
      LDObserve.recordError(err);
    },
  };
}
