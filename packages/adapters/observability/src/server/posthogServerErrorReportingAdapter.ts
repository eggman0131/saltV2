import type { ErrorReportingPort } from '@salt/domain';
import { captureServerException } from './init.js';

// Server-side error reporter, backed by posthog-node exception capture. There
// was no server error reporter before this phase; firebase-functions/logger
// stays additively at the CF call sites — this reports the same failures to
// PostHog error tracking so they surface alongside browser-side exceptions.
export function createPosthogServerErrorReportingAdapter(): ErrorReportingPort {
  return {
    report(error: unknown): void {
      // captureServerException stays inert before init and swallows any SDK
      // failure, so a dropped report can never throw across the port boundary
      // (CLAUDE.md Rule 10).
      captureServerException(error);
    },
  };
}
