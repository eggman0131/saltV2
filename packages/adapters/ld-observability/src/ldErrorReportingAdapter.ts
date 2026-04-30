import { LDObserve } from '@launchdarkly/observability';
import type { ErrorReportingPort } from '@salt/domain';

export function createLDErrorReportingAdapter(): ErrorReportingPort {
  return {
    report(error: unknown): void {
      const err = error instanceof Error ? error : new Error(String(error));
      LDObserve.recordError(err);
    },
  };
}
