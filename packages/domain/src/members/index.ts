// Members module — published surface (issue #155).
// This file is the ONLY thing other domain modules and adapters are allowed to
// import from members. Anything not re-exported here is private.

export type { Member } from './entities/Member.js';

export { normaliseMemberEmail } from './commands/normaliseMemberEmail.js';
export { createMember } from './commands/createMember.js';
export type { CreateMemberInput } from './commands/createMember.js';
export { updateMember } from './commands/updateMember.js';
export type { UpdateMemberPatch } from './commands/updateMember.js';

export { memberInitials } from './queries/memberInitials.js';
export { sortMembers } from './queries/sortMembers.js';
