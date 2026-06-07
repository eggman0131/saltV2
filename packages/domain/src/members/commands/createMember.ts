import type { Member } from '../entities/Member.js';
import { normaliseMemberEmail } from './normaliseMemberEmail.js';

export interface CreateMemberInput {
  readonly name: string;
  readonly email: string;
  readonly admin: boolean;
  readonly sortOrder: number;
  readonly icon?: string | null;
  readonly now: string; // ISO-8601
}

// Build a new Member from admin-screen input (issue #155). The normalised email
// is both the entity id and the Firestore doc key, so creating a member with an
// email that already exists is an upsert of that key — callers decide whether
// that is allowed. Name is trimmed; icon defaults to null (initials avatar).
export function createMember(input: CreateMemberInput): Member {
  const email = normaliseMemberEmail(input.email);
  return {
    id: email,
    schemaVersion: 1,
    name: input.name.trim(),
    email,
    admin: input.admin,
    sortOrder: input.sortOrder,
    icon: input.icon ?? null,
    updatedAt: input.now,
  };
}
