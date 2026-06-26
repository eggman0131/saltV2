import type { MatchLoggingPort, MatchLogEntry } from '@salt/domain';
import { captureServerEvent } from './init.js';
import type { ObservabilitySpan } from './init.js';
import { CANON_MATCH_EVENT, toCanonMatchEvent } from '../shared/matchOutcomeEvent.js';

// Server-side (cf-path) canon match/create logger. Emits the slim `canon.match`
// outcome event via posthog-node capture, using the SAME runtime-neutral mapper
// the fast-path browser adapter uses — toCanonMatchEvent(entry, 'cf') — so the
// wire schema cannot drift between the two emission sites. The optional
// `parentSpan` is accepted for call-site signature parity with the LD server
// adapter (which nested a span) but is unused: PostHog carries the path tag in
// the event itself and trace propagation is DORMANT.
export function createPosthogServerMatchLoggingAdapter(
  _parentSpan?: ObservabilitySpan,
): MatchLoggingPort {
  return {
    write(entry: MatchLogEntry): Promise<void> {
      // captureServerEvent stays inert before init and swallows any SDK failure,
      // so a telemetry error can never reject this promise across the port
      // boundary (CLAUDE.md Rule 10).
      captureServerEvent(CANON_MATCH_EVENT, { ...toCanonMatchEvent(entry, 'cf') });
      return Promise.resolve();
    },
  };
}
