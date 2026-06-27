import { describe, it, expect, beforeEach, afterEach, vi, type Mocked } from 'vitest';
import type { DomainError } from '@salt/shared-types';

// ─── Shared report() spy (Phase 2 write-path reporting) ─────────────────────────
// The service caches getErrorReporter(); the adapter mock must return a STABLE
// report so we can assert on it across calls. We delegate to the REAL category
// gate (isReportableCategory) so "suppressed write failure does NOT surface"
// exercises the actual report/suppress boundary — not a forked predicate.
const { reportSpy, gatedReport } = vi.hoisted(() => {
  const reportSpy = vi.fn();
  return { reportSpy, gatedReport: reportSpy };
});

vi.mock('@salt/observability', async () => {
  const actual = await vi.importActual<typeof import('@salt/observability')>('@salt/observability');
  return {
    isReportableCategory: actual.isReportableCategory,
    createObservabilityErrorReportingAdapter: vi.fn(() => ({
      // Mirror the real adapter: gate by category, then forward. This keeps the
      // suppression behaviour under test instead of stubbing it away.
      report: (error: unknown, category: DomainError['kind']) => {
        if (!actual.isReportableCategory(category)) return;
        gatedReport(error, category);
      },
    })),
    createObservabilityMatchLoggingAdapter: vi.fn(() => ({
      write: vi.fn().mockResolvedValue(undefined),
    })),
    startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })),
  };
});

vi.mock('@salt/firebase-sync', () => ({
  subscribeCanonItems: vi.fn(() => vi.fn()),
  subscribeAisles: vi.fn(() => vi.fn()),
  upsertCanonItem: vi.fn().mockResolvedValue(undefined),
  deleteCanonItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  callMatchOrCreate: vi.fn(),
  callRegenerateCanonIcon: vi.fn(),
  isAuthTransitioning: vi.fn(() => false),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  addCanonItem,
  deleteCanonItem,
  regenerateCanonIcon,
  unhideCanonIcon,
  __resetCanonServiceForTest,
} from '../src/lib/canonService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const STORAGE_ERR: DomainError = { kind: 'StorageError', reason: 'unavailable' };
const SYNC_ERR: DomainError = { kind: 'SyncError', reason: 'push-failed' };
const NETWORK_ERR: DomainError = { kind: 'NetworkError', reason: 'offline' };
const NOTFOUND_ERR: DomainError = { kind: 'NotFound', resource: 'canon', id: 'x' };

describe('canonService — write/command failure reporting (Phase 2)', () => {
  beforeEach(() => {
    __resetCanonServiceForTest();
    vi.clearAllMocks();
    reportSpy.mockReset();
  });

  afterEach(() => {
    __resetCanonServiceForTest();
  });

  describe('addCanonItem (matchOrCreateCanon AI callable)', () => {
    it('reports a StorageError callable failure', async () => {
      fs.callMatchOrCreate.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await addCanonItem('milk', null, true);
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });

    it('does NOT surface a NetworkError callable failure (gate suppresses)', async () => {
      fs.callMatchOrCreate.mockResolvedValueOnce({ kind: 'err', error: NETWORK_ERR });
      await addCanonItem('milk', null, true);
      expect(reportSpy).not.toHaveBeenCalled();
    });
  });

  describe('deleteCanonItem (firebase-sync adapter)', () => {
    it('reports a StorageError adapter failure', async () => {
      fs.deleteCanonItem.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await deleteCanonItem('id');
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });

    it('does NOT surface a NotFound adapter failure (gate suppresses)', async () => {
      fs.deleteCanonItem.mockResolvedValueOnce({ kind: 'err', error: NOTFOUND_ERR });
      await deleteCanonItem('id');
      expect(reportSpy).not.toHaveBeenCalled();
    });

    it('does NOT report on success', async () => {
      fs.deleteCanonItem.mockResolvedValueOnce({ kind: 'ok', value: undefined });
      await deleteCanonItem('id');
      expect(reportSpy).not.toHaveBeenCalled();
    });
  });

  describe('regenerateCanonIcon / unhideCanonIcon (regenerate AI callable)', () => {
    it('reports a SyncError regenerate failure', async () => {
      fs.callRegenerateCanonIcon.mockResolvedValueOnce({ kind: 'err', error: SYNC_ERR });
      await regenerateCanonIcon('id');
      expect(reportSpy).toHaveBeenCalledWith(SYNC_ERR, 'SyncError');
    });

    it('reports a StorageError unhide failure', async () => {
      fs.callRegenerateCanonIcon.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await unhideCanonIcon('id');
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });
  });
});
