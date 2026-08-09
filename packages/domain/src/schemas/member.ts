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
  // Which cook mode this person's Cook button opens (issue #776). A PREFERENCE,
  // never a permission: whichever way it is set, the other mode stays one tap
  // away on the same control.
  //
  // It lives here rather than in a per-user collection of its own because a
  // member doc IS the per-person record — adding a field to it is not the fourth
  // owner-scoped collection, and the family-shared rule is untouched.
  //
  // `.default()` for the usual reason (back-compat on read: every member doc in
  // production predates the field), and 'standard' specifically because that is
  // what everyone gets today. Absent must mean "nothing changed for you".
  cookMode: z.enum(['standard', 'guided']).default('standard'),
  updatedAt: z.string(),
});

export type CookMode = z.infer<typeof MemberSchema>['cookMode'];

export type MemberDoc = z.infer<typeof MemberSchema>;
