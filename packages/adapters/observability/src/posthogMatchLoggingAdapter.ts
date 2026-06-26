import type { MatchLoggingPort, MatchLogEntry } from '@salt/domain';
import { safePosthog } from './init.js';
import type { ObservabilitySpan } from './init.js';
import { CANON_MATCH_EVENT, toCanonMatchEvent } from './shared/matchOutcomeEvent.js';

// Fast-path canon match/create logger. Emits the slim `canon.match` outcome
// event via posthog.capture. The optional `parentSpan` is accepted for
// call-site signature parity with the LD adapter (which threaded a span) but is
// unused: PostHog has no span/trace primitive, the slim event carries its own
// path tag, and trace propagation is DORMANT.
export function createPosthogMatchLoggingAdapter(
  path: 'fast' | 'cf',
  _parentSpan?: ObservabilitySpan,
): MatchLoggingPort {
  return {
    write(entry: MatchLogEntry): Promise<void> {
      // safePosthog stays inert before init and swallows any SDK failure, so a
      // telemetry error can never reject this promise across the port boundary.
      safePosthog((ph) => {
        ph.capture(CANON_MATCH_EVENT, { ...toCanonMatchEvent(entry, path) });
      });
      return Promise.resolve();
    },
  };
}
