import { subscribeMembers, upsertMember, deleteMember } from '@salt/firebase-sync';
import {
  createMember,
  updateMember,
  sortMembers,
  normaliseMemberEmail,
  type Member,
  type CookMode,
  type UpdateMemberPatch,
} from '@salt/domain';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, derived, get, toStore } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { auth } from './auth.svelte.js';
import { subscriptionErrorHandler } from './errorReporting.js';

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
    subscriptionErrorHandler(() => {
      // A stream-level error (e.g. permission-denied) leaves the roster empty;
      // stop the spinner so the UI can settle rather than hang.
      _isLoadingMembers.set(false);
    }),
  );
  return unsub;
}

// ─── Admin / current-member resolution ─────────────────────────────────────────

// The signed-in user's member record, or null when nobody is signed in / the
// roster hasn't loaded / their email isn't on it.
//
// `uid → normalised email → member id` is the WHOLE of personalisation in Salt
// (issue #634): every collection is family-shared, so a personal view is a filter
// over shared documents, never a per-user store. This derivation used to sit
// inline in App.svelte for the admin check; it lives here now because the personal
// view needs the same answer.
//
// `toStore` bridges the rune-based auth store into store-land so this can be a
// plain derived store usable from `.ts` services as well as components.
const currentEmail: Readable<string> = toStore(() => auth.user?.email ?? '');

export const currentMember: Readable<Member | null> = derived(
  [members, currentEmail],
  ([$members, $email]) => {
    if (!$email) return null;
    const normalised = normaliseMemberEmail($email);
    return $members.find((m) => m.email === normalised) ?? null;
  },
);

// The first word of a display name — how a member is NAMED on screen, anywhere a
// full name would be noise. Every member of one household tends to share a
// surname, so "Kate Pendery" adds a word that distinguishes nobody.
//
// Presentation, not policy, which is why this lives here and not in
// `@salt/domain`: taking the first word of a display string is a rendering
// choice, and the domain layer owns no opinion about it. It is a shared function
// rather than an inline `split(' ')[0]` at each site precisely because there is
// now more than one — the kitchen label below, and recipe attribution (issue
// #845) — and two copies of a truncation rule drift.
//
// Rendering ONLY: the stored value stays the verbatim `Member.name`. Identity
// comparisons — the recipe list's "Added by me" `===`, the editor picker's
// dedupe — must keep reading the full name, or two people who share a first name
// collapse into one.
//
// `''` in, `''` out: an unattributed record has no name to shorten.
export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

// How the signed-in member's own space is named, wherever it is named: the header
// link in App.svelte and the `/mine` page heading both read this, so the link and
// the page it opens can never disagree about what you are called (issue #828).
//
// `'My Kitchen'` is a real state, not a defensive fallback. There is no
// `displayName` on the auth user (`domain/src/auth/entities/User.ts` is `{ uid,
// email }`), so the name only exists once `initMembersSync` has resolved — every
// cold launch shows it for a moment — and a sign-in whose email is not on the
// roster shows it for good.
export const kitchenLabel: Readable<string> = derived(currentMember, ($member) =>
  $member ? `${firstName($member.name)}'s Kitchen` : 'My Kitchen',
);

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

// The one member write a NON-ADMIN may make, and only ever about themselves
// (issue #776). Its own function rather than a call to `updateMemberEntry` so the
// id cannot be supplied by a caller: this reads the signed-in member and writes
// that doc, which is precisely what firestore.rules will allow and nothing else.
//
// A no-op when nothing would change, so opening Settings and leaving cannot write
// — and when there is no member doc yet, which is a signed-in-but-not-on-the-roster
// state the rules would refuse anyway.
export async function setMyCookMode(mode: CookMode): Promise<ReadResult<void, DomainError>> {
  const me = get(currentMember);
  if (!me) return failure({ kind: 'StorageError', reason: 'unavailable' });
  if (me.cookMode === mode) return { kind: 'ok', value: undefined };
  return upsertMember(updateMember(me, { cookMode: mode }, new Date().toISOString()));
}

// Drag-and-drop reorder: reassign sortOrder to the new sequential position and
// persist only the members whose position actually changed. Mirrors the aisle
// reorder UX; members absent from `orderedIds` keep their existing order.
export async function reorderMembers(orderedIds: string[]): Promise<void> {
  const byId = new Map(get(_members).map((m) => [m.id, m]));
  const now = new Date().toISOString();
  const writes: Promise<ReadResult<void, DomainError>>[] = [];
  orderedIds.forEach((id, index) => {
    const member = byId.get(id);
    if (member && member.sortOrder !== index) {
      writes.push(upsertMember(updateMember(member, { sortOrder: index }, now)));
    }
  });
  await Promise.all(writes);
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
