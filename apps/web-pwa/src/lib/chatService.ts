import {
  subscribeChatSessions,
  saveChatSession,
  deleteChatSession,
  streamChefChat,
} from '@salt/firebase-sync';
import { createLDErrorReportingAdapter } from '@salt/ld-observability';
import type { ChatSessionDoc } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Chat service (issue #206, Phase 3). Optimistic store over the per-user
// firebase-sync adapter. Follows the recipeService.ts pattern exactly.

const _sessions = writable<readonly ChatSessionDoc[]>([]);
export const sessions: Readable<readonly ChatSessionDoc[]> = _sessions;

const _isLoadingSessions = writable(true);
export const isLoadingSessions: Readable<boolean> = _isLoadingSessions;

let _errorReporter: ReturnType<typeof createLDErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createLDErrorReportingAdapter();
  return _errorReporter;
}

// Optimistic snapshot guard — same pattern as recipeService.ts.
const latestLocalEdit = new Map<string, string>();

function applySnapshot(incoming: ChatSessionDoc[]): void {
  const currentById = new Map(get(_sessions).map((s) => [s.id, s]));
  const result: ChatSessionDoc[] = [];
  const seen = new Set<string>();
  for (const s of incoming) {
    seen.add(s.id);
    const local = latestLocalEdit.get(s.id);
    if (local !== undefined && s.updatedAt < local) {
      const ours = currentById.get(s.id);
      if (ours) result.push(ours);
      continue;
    }
    if (s.updatedAt) latestLocalEdit.set(s.id, s.updatedAt);
    result.push(s);
  }
  for (const [id, s] of currentById) {
    if (!seen.has(id) && latestLocalEdit.has(id)) result.push(s);
  }
  _sessions.set(result);
}

export function initChatSync(ownerUid: string): () => void {
  _isLoadingSessions.set(true);
  const errors = getErrorReporter();
  const unsub = subscribeChatSessions(
    ownerUid,
    (incoming) => {
      applySnapshot(incoming);
      _isLoadingSessions.set(false);
    },
    (err) => {
      errors.report(err);
      _isLoadingSessions.set(false);
    },
  );
  return unsub;
}

function now(): string {
  return new Date().toISOString();
}

function newSession(ownerUid: string, recipeId: string | null): ChatSessionDoc {
  const ts = now();
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    ownerUid,
    recipeId,
    title: recipeId ? 'Recipe chat' : 'New chat',
    messages: [],
    createdAt: ts,
    updatedAt: ts,
    expiresAt: ts, // saveChatSession will overwrite with now + 14 days
  };
}

export async function createChatSession(
  ownerUid: string,
  recipeId: string | null = null,
): Promise<ReadResult<ChatSessionDoc, DomainError>> {
  const session = newSession(ownerUid, recipeId);
  const stamped = { ...session, updatedAt: now() };
  latestLocalEdit.set(stamped.id, stamped.updatedAt);
  _sessions.set([...get(_sessions), stamped]);
  const result = await saveChatSession(stamped);
  if (result.kind === 'err') return result;
  return success(stamped);
}

export async function persistSession(
  session: ChatSessionDoc,
): Promise<ReadResult<void, DomainError>> {
  const stamped = { ...session, updatedAt: now() };
  latestLocalEdit.set(stamped.id, stamped.updatedAt);
  const others = get(_sessions).filter((s) => s.id !== stamped.id);
  _sessions.set([...others, stamped]);
  return saveChatSession(stamped);
}

export async function removeSession(id: string): Promise<ReadResult<void, DomainError>> {
  latestLocalEdit.set(id, now());
  _sessions.set(get(_sessions).filter((s) => s.id !== id));
  return deleteChatSession(id);
}

// Send a user message: appends the user turn, streams the assistant reply,
// then appends the final assistant turn and persists the session once.
// onChunk is called for each streaming text fragment so the UI can render
// the partial reply live; the full reply is committed to the session on finish.
export async function sendMessage(
  session: ChatSessionDoc,
  text: string,
  onChunk: (chunk: string) => void,
): Promise<ReadResult<ChatSessionDoc, DomainError>> {
  const userMsg: ChatSessionDoc['messages'][number] = {
    id: crypto.randomUUID(),
    role: 'user',
    text,
    createdAt: now(),
  };

  const sessionWithUser: ChatSessionDoc = {
    ...session,
    messages: [...session.messages, userMsg],
    title: session.messages.length === 0 ? text.slice(0, 60) : session.title,
  };

  // Optimistically update with user message. Snapshot the prior store state so a
  // failed send can be rolled back — the turn is only persisted on success, so a
  // left-behind optimistic turn would otherwise accumulate as a ghost on retry.
  const prevSessions = get(_sessions);
  const stampedUser = { ...sessionWithUser, updatedAt: now() };
  latestLocalEdit.set(stampedUser.id, stampedUser.updatedAt);
  const others = prevSessions.filter((s) => s.id !== stampedUser.id);
  _sessions.set([...others, stampedUser]);

  const streamResult = await streamChefChat(
    { messages: session.messages, newMessage: text, recipeId: session.recipeId },
    onChunk,
  );

  if (streamResult.kind === 'err') {
    _sessions.set(prevSessions);
    return streamResult;
  }

  const assistantMsg: ChatSessionDoc['messages'][number] = {
    id: crypto.randomUUID(),
    role: 'assistant',
    text: streamResult.value,
    createdAt: now(),
  };

  const finalSession: ChatSessionDoc = {
    ...stampedUser,
    messages: [...stampedUser.messages, assistantMsg],
  };

  const saveResult = await persistSession(finalSession);
  if (saveResult.kind === 'err') return saveResult;
  return success(finalSession);
}
