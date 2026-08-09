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
  // Variation chats (issue #763): the dish this conversation started from, which
  // the chat is NOT attached to. Read server-side like `recipeId`, but injected
  // under a different heading — "the starting point for a NEW dish" rather than
  // "the recipe the user is asking about" — so the chef proposes rather than
  // amends. Optional so every existing caller is unchanged.
  basedOnRecipeId: z.string().nullable().optional(),
});

export type ChefChatInput = z.infer<typeof ChefChatInputSchema>;
