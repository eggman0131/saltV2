import { subscribeMembers, upsertMember, deleteMember } from '@salt/firebase-sync';
import {
  createMember,
  updateMember,
  sortMembers,
  normaliseMemberEmail,
  type Member,
  type UpdateMemberPatch,
} from '@salt/domain';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

// ─── Reactive stores ─────────────────────────────────────────────────────────

const _members = writable<Member[]>([]);
// Always exposed in display order (sortOrder, then name).
export const members: Readable<Member[]> = {
  subscribe: (run, invalidate) =>
    _members.subscribe((value) => run(sortMembers(value)), invalidate),
};

const _isLoadingMembers = writable(true);
export const isLoadingMembers: Readable<boolean> = _isLoadingMembers;

// ─── Init / cleanup ───────────────────────────────────────────────────────────

export function initMembersSync(): () => void {
  _isLoadingMembers.set(true);
  const unsub = subscribeMembers(
    (list) => {
      _members.set(list);
      _isLoadingMembers.set(false);
    },
    (_err) => {
      // A stream-level error (e.g. permission-denied) leaves the roster empty;
      // stop the spinner so the UI can settle rather than hang.
      _isLoadingMembers.set(false);
    },
  );
  return unsub;
}

// ─── Admin / current-member resolution ─────────────────────────────────────────

// Non-reactive snapshot: find the member matching an email (normalised). Used
// by the route guard. Components compute admin reactively from the `members`
// store + auth.user instead.
export function findMemberByEmail(email: string | null | undefined): Member | null {
  if (!email) return null;
  const normalised = normaliseMemberEmail(email);
  return get(_members).find((m) => m.email === normalised) ?? null;
}

export function isEmailAdmin(email: string | null | undefined): boolean {
  return findMemberByEmail(email)?.admin === true;
}

// ─── Mutations ──────────────────────────────────────────────────────────────

// Append after the current highest sortOrder unless an explicit order is given,
// so new members land at the end of the roster.
function nextSortOrder(): number {
  const list = get(_members);
  if (list.length === 0) return 0;
  return Math.max(...list.map((m) => m.sortOrder)) + 1;
}

export interface CreateMemberEntryInput {
  readonly name: string;
  readonly email: string;
  readonly admin: boolean;
  readonly sortOrder?: number;
}

export async function createMemberEntry(
  input: CreateMemberEntryInput,
): Promise<ReadResult<void, DomainError>> {
  const member = createMember({
    name: input.name,
    email: input.email,
    admin: input.admin,
    sortOrder: input.sortOrder ?? nextSortOrder(),
    now: new Date().toISOString(),
  });
  return upsertMember(member);
}

export async function updateMemberEntry(
  id: string,
  patch: UpdateMemberPatch,
): Promise<ReadResult<void, DomainError>> {
  const current = get(_members).find((m) => m.id === id);
  if (!current) return failure({ kind: 'StorageError', reason: 'unavailable' });
  const next = updateMember(current, patch, new Date().toISOString());
  return upsertMember(next);
}

export async function deleteMemberEntry(id: string): Promise<ReadResult<void, DomainError>> {
  return deleteMember(id);
}

// ─── Test / e2e helpers ───────────────────────────────────────────────────────

export function __resetMembersServiceForTest(): void {
  _members.set([]);
  _isLoadingMembers.set(true);
}

export function getMembersSnapshot(): Member[] {
  return sortMembers(get(_members));
}

export function seedMembers(list: Member[]): void {
  _members.set(list);
  _isLoadingMembers.set(false);
}
