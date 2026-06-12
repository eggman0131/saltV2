import { z } from 'zod';

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  createdAt: z.string(),
});

export const ChatSessionSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  ownerUid: z.string(),
  recipeId: z.string().nullable(),
  title: z.string(),
  messages: z.array(MessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
});

export type MessageDoc = z.infer<typeof MessageSchema>;
export type ChatSessionDoc = z.infer<typeof ChatSessionSchema>;
