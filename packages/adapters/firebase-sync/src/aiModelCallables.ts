import type { DomainError, ReadResult } from '@salt/shared-types';
import type { AiModelRole } from '@salt/domain/schemas';
import { callFunction } from './callFunction.js';

// Browser → admin-only Phase 3 callables. CLAUDE.md rule #2: the Firebase SDK is
// only touched here. The web service consumes these wrappers, never
// `firebase/functions` directly. Mirrors equipmentCallables.ts: map the callable
// error codes to DomainError and return a ReadResult.

export interface AiCatalogModel {
  readonly name: string;
  readonly displayName: string;
}
export interface AiModelCatalog {
  readonly byRole: Record<AiModelRole, AiCatalogModel[]>;
  readonly fetchedAt: number;
}
export interface TestModelOutcome {
  readonly ok: boolean;
  readonly error?: string;
}

/** Fetches the capability-filtered model catalog. `forceRefresh` bypasses the CF cache. */
export async function callListAiModels(
  forceRefresh = false,
): Promise<ReadResult<AiModelCatalog, DomainError>> {
  return callFunction<{ forceRefresh: boolean }, AiModelCatalog>({
    name: 'listAiModels',
    input: { forceRefresh },
  });
}

/** Probes a single model (server-side); resolves to ok/error rather than throwing for a failed probe. */
export async function callTestModel(
  model: string,
  role?: AiModelRole,
): Promise<ReadResult<TestModelOutcome, DomainError>> {
  return callFunction<{ model: string; role?: AiModelRole }, TestModelOutcome>({
    name: 'testModel',
    // The ternary, not `{ model, role }`: an absent role must stay OFF the
    // payload rather than ride as `undefined`.
    input: role ? { model, role } : { model },
  });
}
