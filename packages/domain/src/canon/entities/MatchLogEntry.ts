export interface CandidateLog {
  readonly itemId: string;
  readonly itemName?: string;
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

export interface SurfacedCandidateLog {
  readonly itemId: string;
  readonly itemName: string;
  readonly confidence: number;
  readonly stage: number;
}

export type FinalDecision = 'matched' | 'created' | 'ai_arbitrated' | 'surfaced_candidates';

export interface MatchLogEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly rawInput: string;
  readonly normalizedInput: string;
  readonly stages: readonly StageLog[];
  readonly finalDecision: FinalDecision;
  readonly finalItemId: string | null;
  readonly finalItemName: string | null;
  readonly surfacedCandidates: readonly SurfacedCandidateLog[] | null;
}
