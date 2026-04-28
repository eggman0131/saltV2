export interface CandidateLog {
  readonly itemId: string;
  readonly score: number;
  readonly reason?: string;
}

export interface StageLog {
  readonly stage: number;
  readonly stageName: string;
  readonly threshold: number;
  readonly passed: boolean;
  readonly candidates: readonly CandidateLog[];
}

export type FinalDecision = 'matched' | 'created' | 'ai_arbitrated';

export interface MatchLogEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly rawInput: string;
  readonly normalizedInput: string;
  readonly stages: readonly StageLog[];
  readonly finalDecision: FinalDecision;
  readonly finalItemId: string | null;
}
