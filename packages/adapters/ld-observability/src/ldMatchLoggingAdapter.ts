import { summarizeMatchLog } from '@salt/domain';
import type { MatchLoggingPort, MatchLogEntry } from '@salt/domain';
import { startSpan } from './init.js';
import type { ObservabilitySpan } from './init.js';

const LD_ATTR_MAX = 2000;

function truncate(s: string): string {
  return s.length > LD_ATTR_MAX ? s.slice(0, LD_ATTR_MAX) : s;
}

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
      const { oneLine, multiLine } = summarizeMatchLog(entry);

      span.setAttribute('canon.path', path);
      span.setAttribute('canon.summary', oneLine);
      span.setAttribute('canon.trace', multiLine);
      span.setAttribute('canon.input_count', entry.inputItemCount);
      span.setAttribute('canon.total_duration_ms', entry.totalDurationMs);
      span.setAttribute('canon.decision', entry.finalDecision);
      span.setAttribute('canon.correlation_id', entry.id);
      span.setAttribute('canon.input', entry.rawInput);
      if (entry.normalizedInput !== entry.rawInput) {
        span.setAttribute('canon.normalized', entry.normalizedInput);
      }
      if (entry.finalItemName) {
        span.setAttribute('canon.result', entry.finalItemName);
      }
      if (entry.finalItemId) {
        span.setAttribute('canon.result_id', entry.finalItemId);
      }

      for (const stage of entry.stages) {
        const n = stage.stage;
        span.setAttribute(`stage.${n}.passed`, stage.passed);
        span.setAttribute(`stage.${n}.considered_count`, stage.consideredCount);
        span.setAttribute(`stage.${n}.duration_ms`, stage.durationMs);
        if (stage.bestScore !== null) {
          span.setAttribute(
            `stage.${n}.best_score`,
            parseFloat((stage.bestScore * 100).toFixed(2)),
          );
        }
        if (stage.gap !== null) {
          span.setAttribute(`stage.${n}.gap`, parseFloat((stage.gap * 100).toFixed(2)));
        }
        if (stage.topCandidates.length > 0) {
          const top = stage.topCandidates[0]!;
          span.setAttribute(`stage.${n}.best_name`, top.itemName ?? top.itemId);
          span.setAttribute(
            `stage.${n}.top`,
            JSON.stringify(
              stage.topCandidates.map((c) => ({
                id: c.itemId,
                name: c.itemName,
                score: parseFloat((c.score * 100).toFixed(2)),
              })),
            ),
          );
        }
      }

      if (entry.arbitration !== null) {
        const arb = entry.arbitration;
        span.setAttribute('arbitration.duration_ms', arb.durationMs);
        span.setAttribute('arbitration.outcome', arb.outcome);
        span.setAttribute('arbitration.candidates_in_count', arb.candidatesIn);
        if (arb.prompt) {
          span.setAttribute('arbitration.prompt', truncate(arb.prompt));
        }
        if (arb.rawResponse) {
          span.setAttribute('arbitration.raw_response', truncate(arb.rawResponse));
        }
      }

      span.end();
      return Promise.resolve();
    },
  };
}
