import type { MatchLoggingPort, MatchLogEntry } from '@salt/domain';
import { startSpan } from './init.js';
import type { ObservabilitySpan } from './init.js';
import { applyMatchLogAttrs } from './shared/matchLogToAttributes.js';

export function createLDMatchLoggingAdapter(
  path: 'fast' | 'cf',
  parentSpan?: ObservabilitySpan,
): MatchLoggingPort {
  return {
    write(entry: MatchLogEntry): Promise<void> {
      const span = startSpan(
        `canon.stages: ${entry.rawInput}`,
        parentSpan ? { parent: parentSpan } : undefined,
      );
      applyMatchLogAttrs(span, entry, path);
      span.end();
      return Promise.resolve();
    },
  };
}
