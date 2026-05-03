import type { ArbitrationLog, MatchLogEntry, StageLog } from '../entities/MatchLogEntry.js';

export interface MatchLogSummary {
  readonly oneLine: string;
  readonly multiLine: string;
}

function nearMissCount(stages: readonly StageLog[]): number {
  return stages.filter((s) => !s.passed && s.bestScore !== null).length;
}

function formatStage(s: StageLog): string {
  const glyph = s.skipReason !== null || s.bestScore === null ? '—' : s.passed ? '✓' : '✗';
  const name = s.stageName.padEnd(18);

  if (s.skipReason !== null) {
    return `  ${glyph} ${name} | skip: ${s.skipReason} (${s.durationMs}ms)`;
  }

  if (s.bestScore === null) {
    return `  ${glyph} ${name} | no candidates | ${s.consideredCount} considered (${s.durationMs}ms)`;
  }

  const top = s.topCandidates[0];
  const label = top?.itemName ?? top?.itemId ?? '?';
  const gapStr = s.gap !== null ? ` | gap ${s.gap >= 0 ? '+' : ''}${s.gap.toFixed(3)}` : '';

  return (
    `  ${glyph} ${name}` +
    ` | best: "${label}" ${s.bestScore.toFixed(3)} / thr ${s.threshold.toFixed(3)}${gapStr}` +
    ` | ${s.consideredCount} considered (${s.durationMs}ms)`
  );
}

function formatArbitration(a: ArbitrationLog): string {
  const header =
    `  AI arbitration: ${a.candidatesIn} candidate${a.candidatesIn !== 1 ? 's' : ''},` +
    ` ${a.aislesIn} aisle${a.aislesIn !== 1 ? 's' : ''}` +
    ` → ${a.outcome || '(no outcome)'} (${a.durationMs}ms)`;

  if (!a.reason) return header;
  return `${header}\n    reason: ${a.reason}`;
}

export function summarizeMatchLog(entry: MatchLogEntry): MatchLogSummary {
  const nearMiss = nearMissCount(entry.stages);

  const oneLine = `'${entry.rawInput}' → ${entry.finalDecision} (${nearMiss} near-miss, ${entry.totalDurationMs}ms)`;

  const lines: string[] = [`'${entry.rawInput}' → ${entry.finalDecision}`];

  for (const stage of entry.stages) {
    lines.push(formatStage(stage));
  }

  if (entry.arbitration !== null) {
    lines.push(formatArbitration(entry.arbitration));
  }

  lines.push(`  Total: ${entry.totalDurationMs}ms | ${entry.inputItemCount} items in store`);

  return { oneLine, multiLine: lines.join('\n') };
}
