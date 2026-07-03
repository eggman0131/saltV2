import { logger } from 'firebase-functions';
import type { ArbitrationRequest, CanonArbitrationPort } from '@salt/domain';
import { failure, success } from '@salt/shared-types';
import { arbitrateCanonFlow } from '../flows/arbitrateCanon.js';
import { withAiTimeout } from './withAiTimeout.js';

export function createServerArbitrationAdapter(): CanonArbitrationPort {
  return {
    async arbitrate(req: ArbitrationRequest) {
      try {
        // Mutable copies for the flow's input schema. The flow's outputSchema is the
        // shared `ArbitrationResultSchema` the domain `ArbitrationResult` derives from
        // (issue #417), so the return type already matches the port — no cast needed.
        const flowInput = {
          normalisedName: req.normalisedName,
          candidates: req.candidates.map((c) => ({
            item: { id: c.item.id, name: c.item.name },
            confidence: c.confidence,
          })),
          aisles: req.aisles.map((a) => ({ id: a.id, name: a.name })),
          ...(req.rawText !== undefined ? { rawText: req.rawText } : {}),
        };
        const value = await withAiTimeout('arbitrateCanon', () => arbitrateCanonFlow(flowInput));
        return success(value);
      } catch (err) {
        logger.error('matchOrCreateCanon: arbitration failed', { err });
        return failure({ kind: 'NetworkError', reason: 'transient' });
      }
    },
  };
}
