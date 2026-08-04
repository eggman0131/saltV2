import type { ChatSessionDoc } from '@salt/domain/schemas';

import { sendMessage } from '../../lib/chatService.js';
import { addToast } from '../../lib/toastStore.js';

/**
 * The live state of one chef conversation — the partial reply as it streams in and
 * whether a turn is in flight — plus the single send path through `sendMessage`.
 *
 * This is deliberately NOT held inside `ChatThread.svelte`. A host sometimes has to
 * start a turn on a session the component cannot yet be showing: "Optimise for my
 * kitchen" creates the session and sends into the object `createChatSession` handed
 * back, before the sessions store has repopulated and therefore before the thread is
 * on screen. Holding the two live values out here means that turn streams into the
 * same state the component will render the moment it mounts, with one send path
 * rather than a host-side copy of it.
 *
 * The composer's own text stays in the component: it is per-surface, and a canned
 * prompt sent by a host must never appear in the user's input box.
 */
export function createChatThread() {
  let streamingText = $state('');
  let isSending = $state(false);

  return {
    /** The assistant reply as it arrives, '' when nothing is in flight. */
    get streamingText(): string {
      return streamingText;
    },
    get isSending(): boolean {
      return isSending;
    },
    /**
     * Append `text` as a user turn on `session` and stream the reply. Takes the
     * session explicitly rather than reading a store, so a turn sent immediately
     * after creating one uses the object that was just handed back.
     *
     * Returns whether the turn landed; failures toast here and the caller decides
     * what to restore.
     */
    async send(session: ChatSessionDoc, text: string): Promise<boolean> {
      if (isSending) return false;
      isSending = true;
      streamingText = '';

      const result = await sendMessage(session, text, (chunk) => {
        streamingText += chunk;
      });

      isSending = false;
      streamingText = '';

      if (result.kind !== 'ok') {
        addToast('Failed to send message.', 'destructive');
        return false;
      }
      return true;
    },
  };
}

export type ChatThreadState = ReturnType<typeof createChatThread>;
