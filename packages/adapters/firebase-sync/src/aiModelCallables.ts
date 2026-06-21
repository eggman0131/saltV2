import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';
import type { AiModelRole } from '@salt/domain/schemas';

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

function mapCallableError(err: unknown): DomainError {
  const code = (err as { code?: string }).code ?? '';
  if (code === 'functions/unauthenticated') {
    return { kind: 'AuthError', reason: 'unauthenticated' };
  }
  if (code === 'functions/permission-denied') {
    return { kind: 'AuthError', reason: 'forbidden' };
  }
  return { kind: 'NetworkError', reason: 'transient' };
}

/** Fetches the capability-filtered model catalog. `forceRefresh` bypasses the CF cache. */
export async function callListAiModels(
  forceRefresh = false,
): Promise<ReadResult<AiModelCatalog, DomainError>> {
  try {
    const fn = httpsCallable<{ forceRefresh: boolean }, AiModelCatalog>(
      getFunctions(undefined, 'europe-west2'),
      'listAiModels',
    );
    const res = await fn({ forceRefresh });
    return { kind: 'ok', value: res.data };
  } catch (err) {
    return failure(mapCallableError(err));
  }
}

/** Probes a single model (server-side); resolves to ok/error rather than throwing for a failed probe. */
export async function callTestModel(
  model: string,
  role?: AiModelRole,
): Promise<ReadResult<TestModelOutcome, DomainError>> {
  try {
    const fn = httpsCallable<{ model: string; role?: AiModelRole }, TestModelOutcome>(
      getFunctions(undefined, 'europe-west2'),
      'testModel',
    );
    const res = await fn(role ? { model, role } : { model });
    return { kind: 'ok', value: res.data };
  } catch (err) {
    return failure(mapCallableError(err));
  }
}
