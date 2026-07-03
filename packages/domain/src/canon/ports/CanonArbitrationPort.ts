import type { ReadResult, DomainError } from '@salt/shared-types';
import type { Aisle } from '../entities/Aisle.js';
import type { MatchCandidate } from '../entities/MatchCandidate.js';
import type { ArbitrationResult } from '../../schemas/canonArbitration.js';

// Schema-first (issue #417): `ArbitrationResult` is derived from
// `ArbitrationResultSchema` in `@salt/domain/schemas`, which the `arbitrateCanon`
// flow also uses as its outputSchema — so the flow output and this port contract
// share one source of truth and can't drift behind an `as unknown` cast. Re-exported
// here to keep the `@salt/domain` canon surface unchanged.
export type { ArbitrationResult };

export interface ArbitrationRequest {
  readonly normalisedName: string;
  readonly candidates: readonly MatchCandidate[];
  readonly aisles: readonly Aisle[];
  readonly rawText?: string;
}

export interface CanonArbitrationPort {
  arbitrate(req: ArbitrationRequest): Promise<ReadResult<ArbitrationResult, DomainError>>;
}
