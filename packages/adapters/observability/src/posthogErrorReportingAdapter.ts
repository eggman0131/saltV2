import type { ErrorReportingPort } from '@salt/domain';
import { safePosthog } from './init.js';

export function createPosthogErrorReportingAdapter(): ErrorReportingPort {
  return {
    report(error: unknown): void {
      // safePosthog stays inert before init and swallows any SDK failure, so a
      // dropped report can never throw across the port boundary (CLAUDE.md
      // Rule 10).
      safePosthog((ph) => {
        const err = error instanceof Error ? error : new Error(String(error));
        ph.captureException(err);
      });
    },
  };
}
