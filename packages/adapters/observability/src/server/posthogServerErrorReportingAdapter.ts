import type { ErrorReportingPort } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import { captureServerException } from './init.js';
import { isReportableCategory } from '../shared/reportableCategory.js';

// Server-side error reporter, backed by posthog-node exception capture. There
// was no server error reporter before this phase; firebase-functions/logger
// stays additively at the CF call sites — this reports the same failures to
// PostHog error tracking so they surface alongside browser-side exceptions.
//
// Honours the SAME `isReportableCategory` predicate as the browser adapter — the
// single source of truth in src/shared/ — so the report/suppress boundary cannot
// drift between client and CF. Server failures are usually RAW uncategorised
// exceptions (there is no server classifyFirestoreError), so `category` is
// optional and an absent category gates as reportable ("report the unexpected").
export function createPosthogServerErrorReportingAdapter(): ErrorReportingPort {
  return {
    report(error: unknown, category?: DomainError['kind']): void {
      // Gate first: a suppressed category (e.g. a NetworkError surfaced from a
      // classified server path) never reaches PostHog, matching the client.
      if (!isReportableCategory(category)) return;
      // captureServerException stays inert before init and swallows any SDK
      // failure, so a dropped report can never throw across the port boundary
      // (CLAUDE.md Rule 10).
      captureServerException(error);
    },
  };
}
