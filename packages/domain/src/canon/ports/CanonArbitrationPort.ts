import type { ReadResult, DomainError, ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';
import type { MatchCandidate } from '../entities/MatchCandidate.js';

export type ArbitrationResult =
  | {
      readonly kind: 'match';
      readonly itemId: string;
      readonly confidence: number;
      readonly shoppingBehavior: ShoppingBehavior;
      readonly largeQuantityThreshold?: number;
      readonly unit?: CanonItemUnit;
      readonly reasoning?: string;
      readonly prompt?: string;
      readonly rawResponse?: string;
    }
  | {
      readonly kind: 'new';
      readonly canonName: string;
      readonly aisleId: string | null;
      readonly shoppingBehavior: ShoppingBehavior;
      readonly largeQuantityThreshold?: number;
      readonly unit?: CanonItemUnit;
      readonly reasoning?: string;
      readonly prompt?: string;
      readonly rawResponse?: string;
    }
  | {
      readonly kind: 'no-match';
      readonly prompt?: string;
      readonly rawResponse?: string;
    };

export interface ArbitrationRequest {
  readonly normalisedName: string;
  readonly candidates: readonly MatchCandidate[];
  readonly aisles: readonly Aisle[];
  readonly rawText?: string;
}

export interface CanonArbitrationPort {
  arbitrate(req: ArbitrationRequest): Promise<ReadResult<ArbitrationResult, DomainError>>;
}
