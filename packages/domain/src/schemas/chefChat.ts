import { z } from 'zod';
import { MessageSchema } from './chatSession.js';

// Input schema for the chefChat streaming flow (issue #206, Phase 2).
// The flow is stateless: it receives the recent message history + the new turn.
// recipeId is set for recipe-attached sessions; the flow reads the recipe
// server-side and injects it as context when non-null.
export const ChefChatInputSchema = z.object({
  messages: z.array(MessageSchema),
  newMessage: z.string(),
  recipeId: z.string().nullable(),
});

export type ChefChatInput = z.infer<typeof ChefChatInputSchema>;
