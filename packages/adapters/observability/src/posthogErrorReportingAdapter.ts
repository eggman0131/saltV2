import type { ErrorReportingPort } from '@salt/domain';
import { safePosthog } from './init.js';
import { isReportableCategory } from './shared/reportableCategory.js';

// Browser error reporter. Explicit reporting only — posthog-js exception
// autocapture (`capture_exceptions`) stays OFF (see init.ts); failures reach
// PostHog solely through this gated port.
export function createPosthogErrorReportingAdapter(): ErrorReportingPort {
  return {
    report(error: unknown, category): void {
      // Category gate: report the unexpected, suppress the expected. No-op for
      // suppressed kinds (NetworkError/offline, ValidationError, NotFound,
      // ConflictError). The sign-out auth race is gated separately at the call
      // site via the auth-transition flag, so AuthError still passes here.
      if (!isReportableCategory(category)) return;

      // safePosthog stays inert before init and swallows any SDK failure, so a
      // dropped report can never throw across the port boundary (CLAUDE.md
      // Rule 10).
      safePosthog((ph) => {
        // The raw error carries the real stack to PostHog. Firebase errors carry
        // a code, not free-form user content, so the message is safe to keep.
        const err = error instanceof Error ? error : new Error(String(error));
        // Attach ONLY the category as scrubbed context — deliberately do not
        // spread any caller-supplied bag, so free-form user content (e.g. canon
        // match text) can never ride along with a report. Data is family-shared,
        // but user-typed strings still must not be sent (CLAUDE.md §Observability).
        ph.captureException(err, { 'error.category': category });
      });
    },
  };
}
