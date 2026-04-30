import type { FinalDecision, MatchLogEntry, StageLog } from '../entities/MatchLogEntry.js';

export class MatchLogBuilder {
  private rawInput = '';
  private normalizedInput = '';
  private readonly stageLogs: StageLog[] = [];

  start(rawInput: string, normalizedInput: string): void {
    this.rawInput = rawInput;
    this.normalizedInput = normalizedInput;
    this.stageLogs.length = 0;
  }

  addStage(stageLog: StageLog): void {
    this.stageLogs.push(stageLog);
  }

  complete(id: string, finalDecision: FinalDecision, finalItemId: string | null): MatchLogEntry {
    return {
      id,
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      rawInput: this.rawInput,
      normalizedInput: this.normalizedInput,
      stages: [...this.stageLogs],
      finalDecision,
      finalItemId,
    };
  }
}
