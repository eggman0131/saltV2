import type {
  ArbitrationLog,
  FinalDecision,
  MatchLogEntry,
  StageLog,
  SurfacedCandidateLog,
} from '../entities/MatchLogEntry.js';

export class MatchLogBuilder {
  private rawInput = '';
  private normalizedInput = '';
  private readonly stageLogs: StageLog[] = [];
  private _inputItemCount = 0;
  private _startTime = 0;
  private _arbitration: ArbitrationLog | null = null;

  start(rawInput: string, normalizedInput: string): void {
    this.rawInput = rawInput;
    this.normalizedInput = normalizedInput;
    this.stageLogs.length = 0;
    this._inputItemCount = 0;
    this._arbitration = null;
    this._startTime = Date.now();
  }

  setInputItemCount(count: number): void {
    this._inputItemCount = count;
  }

  addStage(stageLog: StageLog): void {
    this.stageLogs.push(stageLog);
  }

  setArbitration(log: ArbitrationLog | null): void {
    this._arbitration = log;
  }

  complete(
    id: string,
    finalDecision: FinalDecision,
    finalItemId: string | null,
    finalItemName: string | null = null,
    surfacedCandidates: readonly SurfacedCandidateLog[] | null = null,
  ): MatchLogEntry {
    return {
      id,
      schemaVersion: 2,
      timestamp: new Date().toISOString(),
      rawInput: this.rawInput,
      normalizedInput: this.normalizedInput,
      inputItemCount: this._inputItemCount,
      totalDurationMs: Math.max(0, Math.round(Date.now() - this._startTime)),
      stages: [...this.stageLogs],
      finalDecision,
      finalItemId,
      finalItemName,
      surfacedCandidates,
      arbitration: this._arbitration,
    };
  }
}
