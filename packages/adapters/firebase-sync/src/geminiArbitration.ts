import { getFunctions, httpsCallable } from 'firebase/functions';
import type {
  CanonArbitrationPort,
  ArbitrationRequest,
  ArbitrationResult,
  ErrorReportingPort,
} from '@salt/domain';

export function createGeminiArbitrationAdapter(
  errors: ErrorReportingPort | null = null,
): CanonArbitrationPort {
  return {
    async arbitrate(req: ArbitrationRequest) {
      try {
        const fn = httpsCallable<ArbitrationRequest, ArbitrationResult>(
          getFunctions(),
          'arbitrateCanon',
        );
        const result = await fn(req);
        return { kind: 'ok', value: result.data };
      } catch (err) {
        errors?.report(err);
        const code = (err as { code?: string }).code ?? '';
        const reason =
          code === 'functions/unauthenticated' || code === 'functions/permission-denied'
            ? 'unreachable'
            : 'transient';
        return { kind: 'err', error: { kind: 'NetworkError', reason } };
      }
    },
  };
}
