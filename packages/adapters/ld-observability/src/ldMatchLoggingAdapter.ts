import { LDObserve } from '@launchdarkly/observability';
import type { MatchLoggingPort, MatchLogEntry } from '@salt/domain';

const STAGE_LABELS: Record<number, string> = {
  1: 'exact name',
  2: 'token overlap',
  3: 'synonym',
  4: 'string similarity',
  5: 'embedding',
  6: 'near-miss',
};

export function createLDMatchLoggingAdapter(): MatchLoggingPort {
  return {
    write(entry: MatchLogEntry): Promise<void> {
      LDObserve.startManualSpan(`canon: ${entry.rawInput}`, (span) => {
        span.setAttribute('canon.input', entry.rawInput);
        if (entry.normalizedInput !== entry.rawInput) {
          span.setAttribute('canon.normalized', entry.normalizedInput);
        }
        span.setAttribute('canon.outcome', entry.finalDecision);

        if (entry.finalItemName) {
          span.setAttribute('canon.result', entry.finalItemName);
        }
        if (entry.finalItemId) {
          span.setAttribute('canon.result_id', entry.finalItemId);
        }

        // Stage-by-stage breakdown — only passed stages get a top candidate
        for (const stage of entry.stages) {
          const label = STAGE_LABELS[stage.stage] ?? `stage ${stage.stage}`;
          span.setAttribute(`stage.${stage.stage}.name`, label);
          span.setAttribute(`stage.${stage.stage}.passed`, stage.passed);
          const top = stage.candidates[0];
          if (top) {
            span.setAttribute(`stage.${stage.stage}.top`, top.itemName ?? top.itemId);
            span.setAttribute(
              `stage.${stage.stage}.score`,
              parseFloat((top.score * 100).toFixed(1)),
            );
          }
        }

        // Surfaced-to-user candidates — includes the best-not-selected
        if (entry.surfacedCandidates && entry.surfacedCandidates.length > 0) {
          span.setAttribute('canon.surfaced_count', entry.surfacedCandidates.length);

          const best = entry.surfacedCandidates[0]!;
          span.setAttribute('canon.best_candidate', best.itemName);
          span.setAttribute(
            'canon.best_candidate_score',
            parseFloat((best.confidence * 100).toFixed(1)),
          );
          span.setAttribute(
            'canon.best_candidate_stage',
            STAGE_LABELS[best.stage] ?? `stage ${best.stage}`,
          );

          const summary = entry.surfacedCandidates
            .map(
              (c) =>
                `${c.itemName} (${(c.confidence * 100).toFixed(0)}% via ${STAGE_LABELS[c.stage] ?? `stage ${c.stage}`})`,
            )
            .join(' | ');
          span.setAttribute('canon.candidates', summary);
        }

        span.end();
      });
      return Promise.resolve();
    },
  };
}
