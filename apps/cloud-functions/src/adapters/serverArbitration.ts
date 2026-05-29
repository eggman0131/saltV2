import { logger } from 'firebase-functions';
import type { ArbitrationRequest, ArbitrationResult, CanonArbitrationPort } from '@salt/domain';
import { failure, success } from '@salt/shared-types';
import { arbitrateCanonFlow } from '../flows/arbitrateCanon.js';

export function createServerArbitrationAdapter(): CanonArbitrationPort {
  return {
    async arbitrate(req: ArbitrationRequest) {
      try {
        // Mutable copies for the flow's input schema; the typed return is cast
        // through unknown because zod infers `T | undefined` for optional fields
        // while the domain ArbitrationResult uses bare optional properties under
        // exactOptionalPropertyTypes.
        const flowInput = {
          normalisedName: req.normalisedName,
          candidates: req.candidates.map((c) => ({
            item: { id: c.item.id, name: c.item.name },
            confidence: c.confidence,
          })),
          aisles: req.aisles.map((a) => ({ id: a.id, name: a.name })),
          ...(req.rawText !== undefined ? { rawText: req.rawText } : {}),
        };
        const value = (await arbitrateCanonFlow(flowInput)) as unknown as ArbitrationResult;
        return success(value);
      } catch (err) {
        logger.error('matchOrCreateCanon: arbitration failed', { err });
        return failure({ kind: 'NetworkError', reason: 'transient' });
      }
    },
  };
}
