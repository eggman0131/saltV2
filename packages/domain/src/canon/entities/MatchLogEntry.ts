export interface CandidateLog {
  readonly itemId: string;
  readonly itemName?: string;
  readonly score: number;
  readonly reason?: string;
}

export type StageSkipReason = 'no_items' | 'embedding_unavailable' | 'embedding_error';

export interface StageLog {
  readonly stage: number;
  readonly stageName: string;
  readonly threshold: number;
  readonly passed: boolean;
  readonly consideredCount: number;
  readonly durationMs: number;
  readonly topCandidates: readonly CandidateLog[];
  readonly bestScore: number | null;
  readonly gap: number | null;
  readonly skipReason: StageSkipReason | null;
}

export interface SurfacedCandidateLog {
  readonly itemId: string;
  readonly itemName: string;
  readonly confidence: number;
  readonly stage: number;
}

export type FinalDecision = 'matched' | 'created' | 'ai_arbitrated' | 'surfaced_candidates';

export interface ArbitrationLog {
  readonly reason: string;
  readonly candidatesIn: number;
  readonly aislesIn: number;
  readonly prompt: string;
  readonly rawResponse: string;
  readonly outcome: string;
  readonly durationMs: number;
}

export interface MatchLogEntry {
  readonly id: string;
  readonly schemaVersion: 2;
  readonly timestamp: string;
  readonly rawInput: string;
  readonly normalizedInput: string;
  readonly inputItemCount: number;
  readonly totalDurationMs: number;
  readonly stages: readonly StageLog[];
  readonly finalDecision: FinalDecision;
  readonly finalItemId: string | null;
  readonly finalItemName: string | null;
  readonly surfacedCandidates: readonly SurfacedCandidateLog[] | null;
  readonly arbitration: ArbitrationLog | null;
}
