import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { DomainError } from '@salt/shared-types';

// Stable, gated report() spy — delegates to the REAL category gate so suppressed
// write failures genuinely no-op (see canonService.errorReporting.test.ts).
const { reportSpy } = vi.hoisted(() => ({ reportSpy: vi.fn() }));

vi.mock('@salt/observability', async () => {
  const actual = await vi.importActual<typeof import('@salt/observability')>('@salt/observability');
  return {
    isReportableCategory: actual.isReportableCategory,
    // Phase 5: addItemToList roots a browser action span. The real helper is inert
    // here (initBrowserTracing was never called → NOOP_ACTION, empty traceparent),
    // so saveShoppingListItem writes no traceContext and the report path is unchanged.
    startUserActionSpan: actual.startUserActionSpan,
    createObservabilityErrorReportingAdapter: vi.fn(() => ({
      report: (error: unknown, category: DomainError['kind']) => {
        if (!actual.isReportableCategory(category)) return;
        reportSpy(error, category);
      },
    })),
  };
});

vi.mock('@salt/firebase-sync', () => ({
  subscribeShoppingLists: vi.fn(),
  createShoppingList: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  renameShoppingList: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteShoppingList: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  subscribeShoppingListItems: vi.fn(),
  saveShoppingListItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteShoppingListItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteShoppingListItems: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  moveShoppingListItems: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  subscribeShoppingListsConfig: vi.fn(),
  saveShoppingListsConfig: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  subscribeMembers: vi.fn(),
  upsertMember: vi.fn(),
  deleteMember: vi.fn(),
  isAuthTransitioning: vi.fn(() => false),
}));

vi.mock('../src/lib/auth.svelte.js', () => ({
  auth: { user: null as { uid: string; email: string | null } | null },
}));

import * as firebaseSync from '@salt/firebase-sync';
import { auth } from '../src/lib/auth.svelte.js';
import { __resetMembersServiceForTest } from '../src/lib/membersService.js';
import {
  addList,
  addItemToList,
  removeItems,
  __resetShoppingListServiceForTest,
} from '../src/lib/shoppingListService.svelte.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const STORAGE_ERR: DomainError = { kind: 'StorageError', reason: 'unavailable' };
const SYNC_ERR: DomainError = { kind: 'SyncError', reason: 'push-failed' };
const NETWORK_ERR: DomainError = { kind: 'NetworkError', reason: 'offline' };
const VALIDATION_ERR: DomainError = { kind: 'ValidationError', code: 0 as never };

beforeEach(() => {
  __resetShoppingListServiceForTest();
  __resetMembersServiceForTest();
  vi.clearAllMocks();
  reportSpy.mockReset();
  fs.createShoppingList.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.saveShoppingListItem.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.deleteShoppingListItems.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.saveShoppingListsConfig.mockResolvedValue({ kind: 'ok', value: undefined });
  auth.user = null;
});

describe('shoppingListService — write failure reporting (Phase 2)', () => {
  describe('addList (createShoppingList adapter)', () => {
    it('reports a StorageError create failure', async () => {
      fs.createShoppingList.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await addList('Groceries');
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });

    it('does NOT surface a NetworkError create failure (gate suppresses)', async () => {
      fs.createShoppingList.mockResolvedValueOnce({ kind: 'err', error: NETWORK_ERR });
      await addList('Groceries');
      expect(reportSpy).not.toHaveBeenCalled();
    });

    it('does NOT report on success', async () => {
      await addList('Groceries');
      expect(reportSpy).not.toHaveBeenCalled();
    });
  });

  describe('addItemToList (saveShoppingListItem adapter)', () => {
    it('reports a SyncError item-write failure', async () => {
      fs.saveShoppingListItem.mockResolvedValueOnce({ kind: 'err', error: SYNC_ERR });
      await addItemToList('list-1', 'milk');
      expect(reportSpy).toHaveBeenCalledWith(SYNC_ERR, 'SyncError');
    });
  });

  describe('removeItems (deleteShoppingListItems adapter)', () => {
    it('reports a StorageError delete failure', async () => {
      fs.deleteShoppingListItems.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await removeItems('list-1', ['i1', 'i2']);
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });

    it('does NOT surface a ValidationError delete failure (gate suppresses)', async () => {
      fs.deleteShoppingListItems.mockResolvedValueOnce({ kind: 'err', error: VALIDATION_ERR });
      await removeItems('list-1', ['i1']);
      expect(reportSpy).not.toHaveBeenCalled();
    });
  });
});
