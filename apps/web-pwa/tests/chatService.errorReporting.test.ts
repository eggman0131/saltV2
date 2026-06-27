import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { DomainError } from '@salt/shared-types';
import type { ChatSessionDoc } from '@salt/domain/schemas';

// Stable, gated report() spy — delegates to the REAL category gate so suppressed
// write failures genuinely no-op (see canonService.errorReporting.test.ts).
const { reportSpy } = vi.hoisted(() => ({ reportSpy: vi.fn() }));

vi.mock('@salt/observability', async () => {
  const actual = await vi.importActual<typeof import('@salt/observability')>('@salt/observability');
  return {
    isReportableCategory: actual.isReportableCategory,
    createObservabilityErrorReportingAdapter: vi.fn(() => ({
      report: (error: unknown, category: DomainError['kind']) => {
        if (!actual.isReportableCategory(category)) return;
        reportSpy(error, category);
      },
    })),
  };
});

vi.mock('@salt/firebase-sync', () => ({
  subscribeChatSessions: vi.fn(() => vi.fn()),
  saveChatSession: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteChatSession: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  streamChefChat: vi.fn(),
  callGenerateChatTitle: vi.fn().mockResolvedValue({ kind: 'ok', value: '' }),
  isAuthTransitioning: vi.fn(() => false),
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  createChatSession,
  persistSession,
  removeSession,
  sendMessage,
} from '../src/lib/chatService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

const STORAGE_ERR: DomainError = { kind: 'StorageError', reason: 'unavailable' };
const SYNC_ERR: DomainError = { kind: 'SyncError', reason: 'push-failed' };
const NETWORK_ERR: DomainError = { kind: 'NetworkError', reason: 'offline' };
const AUTH_ERR: DomainError = { kind: 'AuthError', reason: 'forbidden' };

function makeSession(): ChatSessionDoc {
  const ts = '2026-01-01T00:00:00.000Z';
  return {
    id: 'sess-1',
    schemaVersion: 1,
    ownerUid: 'u1',
    recipeId: null,
    title: 'New chat',
    messages: [],
    createdAt: ts,
    updatedAt: ts,
    expiresAt: ts,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  reportSpy.mockReset();
  fs.saveChatSession.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.deleteChatSession.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.callGenerateChatTitle.mockResolvedValue({ kind: 'ok', value: '' });
});

describe('chatService — write/command failure reporting (Phase 2)', () => {
  describe('createChatSession (saveChatSession adapter)', () => {
    it('reports a StorageError save failure', async () => {
      fs.saveChatSession.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await createChatSession('u1');
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });

    it('does NOT surface a NetworkError save failure (gate suppresses)', async () => {
      fs.saveChatSession.mockResolvedValueOnce({ kind: 'err', error: NETWORK_ERR });
      await createChatSession('u1');
      expect(reportSpy).not.toHaveBeenCalled();
    });
  });

  describe('persistSession (saveChatSession adapter)', () => {
    it('reports a SyncError save failure', async () => {
      fs.saveChatSession.mockResolvedValueOnce({ kind: 'err', error: SYNC_ERR });
      await persistSession(makeSession());
      expect(reportSpy).toHaveBeenCalledWith(SYNC_ERR, 'SyncError');
    });
  });

  describe('removeSession (deleteChatSession adapter)', () => {
    it('reports a StorageError delete failure', async () => {
      fs.deleteChatSession.mockResolvedValueOnce({ kind: 'err', error: STORAGE_ERR });
      await removeSession('sess-1');
      expect(reportSpy).toHaveBeenCalledWith(STORAGE_ERR, 'StorageError');
    });
  });

  describe('sendMessage (chefChat AI stream callable)', () => {
    it('reports an AuthError stream failure (write-path AuthError IS reportable)', async () => {
      fs.streamChefChat.mockResolvedValueOnce({ kind: 'err', error: AUTH_ERR });
      await sendMessage(makeSession(), 'hi', () => {});
      expect(reportSpy).toHaveBeenCalledWith(AUTH_ERR, 'AuthError');
    });

    it('does NOT surface a NetworkError stream failure (gate suppresses)', async () => {
      fs.streamChefChat.mockResolvedValueOnce({ kind: 'err', error: NETWORK_ERR });
      await sendMessage(makeSession(), 'hi', () => {});
      expect(reportSpy).not.toHaveBeenCalled();
    });
  });
});
