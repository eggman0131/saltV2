import {
  subscribeChatSessions,
  saveChatSession,
  deleteChatSession,
  streamChefChat,
  callGenerateChatTitle,
} from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter, trackUsageEvent } from '@salt/observability';
import { reportIfFailed, reportSubscriptionError, reportWriteError } from './errorReporting.js';
import type { ChatSessionDoc } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// Chat service (issue #206, Phase 3). Optimistic store over the per-user
// firebase-sync adapter. Follows the recipeService.ts pattern exactly.

const _sessions = writable<readonly ChatSessionDoc[]>([]);
export const sessions: Readable<readonly ChatSessionDoc[]> = _sessions;

// Synchronous snapshot of the chat-sessions store for e2e (test-infra Phase 5).
// Mirrors getRecipesSnapshot/getMealPlanWeekSnapshot. Lets specs assert the
// owner-scoped session set the realtime subscription actually delivered — the
// crux of the owner-scoping check (Chat is the one owner-scoped exception to the
// family-shared rule), since two users' stores must never cross-contaminate.
export function getChatSessionsSnapshot(): readonly ChatSessionDoc[] {
  return get(_sessions);
}

const _isLoadingSessions = writable(true);
export const isLoadingSessions: Readable<boolean> = _isLoadingSessions;

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
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
    (err, rawError) => {
      reportSubscriptionError(errors, err, rawError);
      _isLoadingSessions.set(false);
    },
  );
  return unsub;
}

function now(): string {
  return new Date().toISOString();
}

// The seed title, shown until the chef has read the first exchange and retitled
// it. "Cauliflower Steaks chat" beats "Recipe chat" for the same reason the list
// on the recipe page exists at all: several conversations about one dish are only
// tellable apart by what they say.
// A variation chat is seeded from its base dish too (issue #763), but as
// "<dish> variation" rather than "<dish> chat" — the two are told apart in the
// list by what they are for, not just by the dish they mention. Like the recipe
// seed, it lasts only until the chef retitles the conversation.
function seedTitle(
  recipeId: string | null,
  recipeTitle: string | undefined,
  basedOnRecipeId: string | null,
): string {
  if (recipeId) return recipeTitle?.trim() ? `${recipeTitle.trim()} chat` : 'Recipe chat';
  if (basedOnRecipeId) {
    return recipeTitle?.trim() ? `${recipeTitle.trim()} variation` : 'Recipe variation';
  }
  return 'New chat';
}

function newSession(
  ownerUid: string,
  recipeId: string | null,
  recipeTitle: string | undefined,
  basedOnRecipeId: string | null,
): ChatSessionDoc {
  const ts = now();
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    ownerUid,
    recipeId,
    basedOnRecipeId,
    title: seedTitle(recipeId, recipeTitle, basedOnRecipeId),
    messages: [],
    createdAt: ts,
    updatedAt: ts,
    expiresAt: ts, // saveChatSession will overwrite with the real expiry
  };
}

// `basedOnRecipeId` is the dish a variation chat STARTS FROM, and is deliberately
// independent of `recipeId`, the dish it belongs to: a variation belongs to
// nothing until "Save as recipe" claims the recipe it produced. That also means
// it keeps the ordinary 14-day expiry until then, which is the right fate for a
// variation nobody saved.
export async function createChatSession(
  ownerUid: string,
  recipeId: string | null = null,
  recipeTitle?: string,
  basedOnRecipeId: string | null = null,
): Promise<ReadResult<ChatSessionDoc, DomainError>> {
  const session = newSession(ownerUid, recipeId, recipeTitle, basedOnRecipeId);
  const stamped = { ...session, updatedAt: now() };
  latestLocalEdit.set(stamped.id, stamped.updatedAt);
  _sessions.set([...get(_sessions), stamped]);
  const result = await saveChatSession(stamped);
  if (result.kind === 'err') {
    reportWriteError(getErrorReporter(), result.error);
    return result;
  }
  trackUsageEvent('chat.started', {
    chat_context: recipeId ? 'recipe' : basedOnRecipeId ? 'variation' : 'blank',
  });
  return success(stamped);
}

export async function persistSession(
  session: ChatSessionDoc,
): Promise<ReadResult<void, DomainError>> {
  const stamped = { ...session, updatedAt: now() };
  latestLocalEdit.set(stamped.id, stamped.updatedAt);
  const others = get(_sessions).filter((s) => s.id !== stamped.id);
  _sessions.set([...others, stamped]);
  return reportIfFailed(getErrorReporter(), await saveChatSession(stamped));
}

// Attach a general chat to the recipe it produced (issue #696). Called once
// "Save as recipe" has written the recipe, so the conversation a dish was born
// from is listed on that dish however long ago it happened.
//
// FIRST CLAIM WINS: `recipeId` is a scalar and a session that already belongs to
// a recipe keeps it. Saving a SECOND recipe from one conversation therefore
// leaves the second recipe with no origin chat — judged vanishingly rare against
// the cost of an array field and two ways to say the same thing.
export async function claimRecipe(
  sessionId: string,
  recipeId: string,
): Promise<ReadResult<void, DomainError>> {
  const session = get(_sessions).find((s) => s.id === sessionId);
  if (!session || session.recipeId !== null) return success(undefined);
  return persistSession({ ...session, recipeId });
}

export async function removeSession(id: string): Promise<ReadResult<void, DomainError>> {
  latestLocalEdit.set(id, now());
  _sessions.set(get(_sessions).filter((s) => s.id !== id));
  return reportIfFailed(getErrorReporter(), await deleteChatSession(id));
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
  const isFirstExchange = session.messages.length === 0;
  // Usage = the send gesture, not the round-trip: a message that then fails to
  // stream still counts as someone using chat. No content rides on the event.
  trackUsageEvent('chat.message_sent', {});

  const userMsg: ChatSessionDoc['messages'][number] = {
    id: crypto.randomUUID(),
    role: 'user',
    text,
    createdAt: now(),
  };

  const sessionWithUser: ChatSessionDoc = {
    ...session,
    messages: [...session.messages, userMsg],
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
    {
      messages: session.messages,
      newMessage: text,
      recipeId: session.recipeId,
      basedOnRecipeId: session.basedOnRecipeId,
    },
    onChunk,
  );

  if (streamResult.kind === 'err') {
    _sessions.set(prevSessions);
    // Report the chefChat AI-callable failure (gate drops NetworkError/offline).
    reportWriteError(getErrorReporter(), streamResult.error);
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

  if (isFirstExchange) {
    // Generate a short title in the background — doesn't block the response.
    void callGenerateChatTitle(text, streamResult.value).then((titleResult) => {
      if (titleResult.kind === 'ok' && titleResult.value.trim()) {
        void persistSession({ ...finalSession, title: titleResult.value.trim() });
      }
    });
  }

  return success(finalSession);
}
