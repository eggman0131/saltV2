import { LDObserve } from '@launchdarkly/observability';
import type { MatchLoggingPort, MatchLogEntry } from '@salt/domain';

export function createLDMatchLoggingAdapter(): MatchLoggingPort {
  return {
    write(entry: MatchLogEntry): Promise<void> {
      LDObserve.startManualSpan('canon.matchOrCreate', (span) => {
        span.setAttribute('canon.raw_input', entry.rawInput);
        span.setAttribute('canon.normalized_input', entry.normalizedInput);
        span.setAttribute('canon.final_decision', entry.finalDecision);
        span.setAttribute('canon.final_item_id', entry.finalItemId ?? '');
        span.setAttribute('canon.schema_version', entry.schemaVersion);

        for (const stage of entry.stages) {
          span.setAttribute(`stage.${stage.stage}.name`, stage.stageName);
          span.setAttribute(`stage.${stage.stage}.passed`, stage.passed);
          span.setAttribute(`stage.${stage.stage}.threshold`, stage.threshold);
          span.setAttribute(`stage.${stage.stage}.top_score`, stage.candidates[0]?.score ?? 0);
        }

        span.end();
      });
      return Promise.resolve();
    },
  };
}
