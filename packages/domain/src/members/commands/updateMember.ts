import type { Member } from '../entities/Member.js';

// Editable fields of a member (issue #155). Email/id are intentionally NOT
// editable: the email is the doc key and the Auth-token join, so changing it is
// a delete-and-recreate, not an in-place edit. Any subset may be supplied.
export interface UpdateMemberPatch {
  readonly name?: string;
  readonly admin?: boolean;
  readonly sortOrder?: number;
  readonly icon?: string | null;
}

// Apply an editable-field patch and re-stamp updatedAt. Pure — returns a new
// Member; the original is untouched.
export function updateMember(member: Member, patch: UpdateMemberPatch, now: string): Member {
  return {
    ...member,
    name: patch.name !== undefined ? patch.name.trim() : member.name,
    admin: patch.admin !== undefined ? patch.admin : member.admin,
    sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : member.sortOrder,
    icon: patch.icon !== undefined ? patch.icon : member.icon,
    updatedAt: now,
  };
}
