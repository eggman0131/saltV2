import { z } from 'zod';

// The generateChatTitle callable's wire contract (issue #932, B3-010/A5-016).
//
// Declared here rather than in the flow because the ADAPTER needs it too:
// `chatCallables.ts` used to restate this shape as a hand-written
// `httpsCallable<{ userMessage: string; assistantResponse: string }, string>`
// type argument, which the compiler had no way to compare against the flow's
// own `z.object`. Renaming a field on one side left the other silently wrong.
// Both sides now derive from this.
export const GenerateChatTitleInputSchema = z.object({
  userMessage: z.string(),
  assistantResponse: z.string(),
});

export type GenerateChatTitleInput = z.infer<typeof GenerateChatTitleInputSchema>;

// The title itself — 2-5 words, already trimmed and capped by the flow.
export const GenerateChatTitleOutputSchema = z.string();

export type GenerateChatTitleOutput = z.infer<typeof GenerateChatTitleOutputSchema>;
