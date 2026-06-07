import { z } from 'zod';

// Wire shape of a `members/{email}` Firestore document (issue #155).
// Validated on read in firebase-sync (subscribeMembers skips corrupt docs).
// `id` equals the normalised email and the doc key; see Member entity.
export const MemberSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  name: z.string(),
  email: z.string(),
  admin: z.boolean(),
  sortOrder: z.number(),
  // Reserved for richer avatars later; null = initials. Tolerate a missing
  // field on read by defaulting to null.
  icon: z.string().nullable().default(null),
  updatedAt: z.string(),
});

export type MemberDoc = z.infer<typeof MemberSchema>;
