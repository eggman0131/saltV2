import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { get } from 'svelte/store';
import type { Member } from '@salt/domain';

vi.mock('@salt/firebase-sync', () => ({
  subscribeMembers: vi.fn(),
  upsertMember: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteMember: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

// The service resolves the signed-in member itself now (issue #634), so it reads
// the auth store. Mock it rather than booting Firebase.
const mockAuth = vi.hoisted(() => ({ user: null as { email: string } | null }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));

import * as firebaseSync from '@salt/firebase-sync';
import {
  members,
  currentMember,
  firstName,
  kitchenLabel,
  isLoadingMembers,
  initMembersSync,
  createMemberEntry,
  updateMemberEntry,
  deleteMemberEntry,
  findMemberByEmail,
  isEmailAdmin,
  seedMembers,
  __resetMembersServiceForTest,
} from '../src/lib/membersService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

type MembersCb = (members: Member[]) => void;

function wireSubscription(): { emit: (m: Member[]) => void; unsub: ReturnType<typeof vi.fn> } {
  const unsub = vi.fn();
  let cb: MembersCb | null = null;
  fs.subscribeMembers.mockImplementation((onMembers) => {
    cb = onMembers as MembersCb;
    return unsub;
  });
  return { emit: (m) => cb!(m), unsub };
}

function member(overrides: Partial<Member> & { id: string }): Member {
  return {
    schemaVersion: 1,
    name: 'Person',
    email: overrides.id,
    admin: false,
    sortOrder: 0,
    icon: null,
    updatedAt: '2026-06-07T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  __resetMembersServiceForTest();
  vi.clearAllMocks();
  fs.upsertMember.mockResolvedValue({ kind: 'ok', value: undefined });
  fs.deleteMember.mockResolvedValue({ kind: 'ok', value: undefined });
});

describe('membersService — subscription-fed store', () => {
  it('exposes members in sorted order and clears loading on first snapshot', () => {
    const { emit } = wireSubscription();
    initMembersSync();
    expect(get(isLoadingMembers)).toBe(true);

    emit([
      member({ id: 'b@e.org', name: 'Bob', sortOrder: 2 }),
      member({ id: 'a@e.org', name: 'Ann', sortOrder: 1 }),
    ]);

    expect(get(isLoadingMembers)).toBe(false);
    expect(get(members).map((m) => m.name)).toEqual(['Ann', 'Bob']);
  });

  it('stops loading when the stream errors', () => {
    const unsub = vi.fn();
    let errCb: ((e: unknown) => void) | null = null;
    fs.subscribeMembers.mockImplementation((_on, onError) => {
      errCb = onError as (e: unknown) => void;
      return unsub;
    });
    initMembersSync();
    errCb!({ kind: 'AuthError', reason: 'forbidden' });
    expect(get(isLoadingMembers)).toBe(false);
  });
});

describe('membersService — admin resolution', () => {
  beforeEach(() => {
    seedMembers([
      member({ id: 'admin@e.org', name: 'Admin', admin: true }),
      member({ id: 'plain@e.org', name: 'Plain', admin: false }),
    ]);
  });

  it('findMemberByEmail matches case-insensitively', () => {
    expect(findMemberByEmail('  Admin@E.ORG ')?.id).toBe('admin@e.org');
  });

  it('isEmailAdmin true for admin, false for non-admin and unknown', () => {
    expect(isEmailAdmin('admin@e.org')).toBe(true);
    expect(isEmailAdmin('plain@e.org')).toBe(false);
    expect(isEmailAdmin('ghost@e.org')).toBe(false);
    expect(isEmailAdmin(null)).toBe(false);
  });
});

// uid → normalised email → member id is the WHOLE of personalisation in Salt
// (issue #634): every collection is family-shared, so "mine" is a filter over
// shared documents, never a per-user store.
describe('membersService — currentMember', () => {
  beforeEach(() => {
    seedMembers([
      member({ id: 'admin@e.org', name: 'Admin', admin: true }),
      member({ id: 'plain@e.org', name: 'Plain' }),
    ]);
  });

  // One test, walked forwards: the email side of `currentMember` is bridged out
  // of the RUNE-based auth store, and the mock here is a plain object, so the
  // bridge only notices a value it has not seen before. In the app `auth.user` is
  // `$state` and every transition propagates — including back to signed out.
  it('resolves the signed-in user to their member record, and to null otherwise', () => {
    mockAuth.user = null;
    expect(get(currentMember)).toBeNull();

    mockAuth.user = { email: '  Plain@E.ORG ' };
    expect(get(currentMember)?.id).toBe('plain@e.org'); // normalised before matching

    mockAuth.user = { email: 'ghost@e.org' };
    expect(get(currentMember)).toBeNull(); // signed in, but not on the roster
  });
});

// The one rendering rule this service owns, and the reason it is a function
// rather than an inline `split(' ')[0]`: the kitchen label and recipe
// attribution (issue #845) both shorten a display name, and two copies drift.
describe('membersService — firstName', () => {
  it('takes the first word, and leaves a name that has only one alone', () => {
    expect(firstName('Kate Pendery')).toBe('Kate');
    expect(firstName('Daniel')).toBe('Daniel');
    expect(firstName('Mary Jane Pendery')).toBe('Mary');
  });

  it('passes an empty name straight through', () => {
    // `''` is a real state, not a bug: an unattributed recipe has no name to
    // shorten, and the caller decides what to render instead.
    expect(firstName('')).toBe('');
  });

  it('is what kitchenLabel shortens with', () => {
    seedMembers([member({ id: 'kate@e.org', name: 'Kate Pendery' })]);
    mockAuth.user = { email: 'kate@e.org' };
    expect(get(kitchenLabel)).toBe("Kate's Kitchen");
  });
});

describe('membersService — mutations', () => {
  it('createMemberEntry upserts a normalised member appended after the max sortOrder', async () => {
    seedMembers([member({ id: 'a@e.org', sortOrder: 5 })]);
    await createMemberEntry({ name: 'New', email: '  New@E.ORG ', admin: true });

    expect(fs.upsertMember).toHaveBeenCalledTimes(1);
    const written = fs.upsertMember.mock.calls[0][0];
    expect(written.id).toBe('new@e.org');
    expect(written.email).toBe('new@e.org');
    expect(written.admin).toBe(true);
    expect(written.sortOrder).toBe(6);
  });

  it('createMemberEntry honours an explicit sortOrder', async () => {
    seedMembers([]);
    await createMemberEntry({ name: 'New', email: 'n@e.org', admin: false, sortOrder: 3 });
    expect(fs.upsertMember.mock.calls[0][0].sortOrder).toBe(3);
  });

  it('updateMemberEntry patches the existing member and keeps the id', async () => {
    seedMembers([member({ id: 'a@e.org', name: 'Old', admin: false, sortOrder: 0 })]);
    await updateMemberEntry('a@e.org', { name: 'New', admin: true });

    const written = fs.upsertMember.mock.calls[0][0];
    expect(written.id).toBe('a@e.org');
    expect(written.name).toBe('New');
    expect(written.admin).toBe(true);
  });

  it('updateMemberEntry returns a Failure when the member is unknown', async () => {
    seedMembers([]);
    const result = await updateMemberEntry('ghost@e.org', { name: 'X' });
    expect(result.kind).toBe('err');
    expect(fs.upsertMember).not.toHaveBeenCalled();
  });

  it('deleteMemberEntry delegates to the adapter', async () => {
    await deleteMemberEntry('a@e.org');
    expect(fs.deleteMember).toHaveBeenCalledWith('a@e.org');
  });
});
