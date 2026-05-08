import type { MatchLoggingPort, MatchLogEntry } from '@salt/domain';
import { startSpan, type ObservabilitySpan } from './init.js';
import { applyMatchLogAttrs } from '../shared/matchLogToAttributes.js';

// Server-side counterpart to createLDMatchLoggingAdapter. Same wire schema —
// applyMatchLogAttrs is the single source of truth for canon.* / stage.{n}.*
// field names, scaling, and truncation.
export function createServerLDMatchLoggingAdapter(
  parentSpan?: ObservabilitySpan,
): MatchLoggingPort {
  return {
    write(entry: MatchLogEntry): Promise<void> {
      const span = startSpan(
        `canon.stages: ${entry.rawInput}`,
        parentSpan ? { parent: parentSpan } : undefined,
      );
      applyMatchLogAttrs(span, entry, 'cf');
      span.end();
      return Promise.resolve();
    },
  };
}
