import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import type { Member } from '@salt/domain';

// `AdminGuard` had no test of its own: every suite that reached it did so through
// a page that seeds an admin, so `admin-guard-denied`'s markup was asserted
// nowhere in the repo and a refactor that dropped the panel would have passed.
//
// This is issue #1055's characterisation net for the guard. It mounts the
// component directly so all three of its render branches are exercised, and it
// pins the ONE input on which the guard's own member resolution and
// `membersService`'s exported `currentMember` disagree today — see the
// "Exception 1" case at the bottom.

const { mockMembers, mockIsLoading, mockAuth } = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockMembers: makeStore<Member[]>([]),
    mockIsLoading: makeStore<boolean>(false),
    mockAuth: { user: { email: 'admin@e.org' } as { email: string } | null },
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));
vi.mock('../src/lib/membersService.js', () => ({
  members: mockMembers,
  isLoadingMembers: mockIsLoading,
}));

import AdminGuard from '../src/routes/admin/AdminGuard.svelte';
import { push } from 'svelte-spa-router';

function member(overrides: Partial<Member> & { id: string }): Member {
  return {
    schemaVersion: 1,
    name: 'Person',
    email: overrides.id,
    admin: false,
    sortOrder: 0,
    icon: null,
    cookMode: 'standard',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

const ADMIN = member({ id: 'admin@e.org', name: 'Ada Admin', admin: true });
const KID = member({ id: 'kid@e.org', name: 'Kid' });

/** What the guard is protecting. Rendered only on the admit branch. */
const guarded = createRawSnippet(() => ({
  render: () => '<div data-testid="guarded-content">operator screen</div>',
}));

function renderGuard() {
  return render(AdminGuard, { props: { children: guarded } });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { email: 'admin@e.org' };
  mockIsLoading._set(false);
  mockMembers._set([ADMIN, KID]);
});

describe('AdminGuard — the three render branches', () => {
  it('shows the spinner and judges nobody while the roster is still loading', () => {
    // Judging early would bounce a legitimate admin on first paint, before the
    // subscription has delivered the row that says they are one.
    mockIsLoading._set(true);
    mockAuth.user = { email: 'admin@e.org' };
    renderGuard();

    expect(screen.getByTestId('admin-guard-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('guarded-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-guard-denied')).not.toBeInTheDocument();
    expect(vi.mocked(push)).not.toHaveBeenCalled();
  });

  it('renders the denied panel AND redirects when a settled roster says non-admin', async () => {
    // Both halves matter and only one of them was covered anywhere: the redirect
    // is asserted by `AdminMembersPage.test.ts`, the panel's markup by nothing.
    mockAuth.user = { email: 'kid@e.org' };
    renderGuard();

    const denied = screen.getByTestId('admin-guard-denied');
    expect(denied).toHaveTextContent("You don't have access to this area.");
    expect(screen.queryByTestId('guarded-content')).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(push)).toHaveBeenCalledWith('/'));
  });

  it('renders the children and redirects nowhere for a settled admin', () => {
    renderGuard();

    expect(screen.getByTestId('guarded-content')).toHaveTextContent('operator screen');
    expect(screen.queryByTestId('admin-guard-denied')).not.toBeInTheDocument();
    expect(vi.mocked(push)).not.toHaveBeenCalled();
  });
});

describe('AdminGuard — how it resolves the signed-in member', () => {
  it.each([
    ['an email that is on the roster, differently cased', 'ADMIN@E.ORG', true],
    ['an email padded with whitespace', '  admin@e.org  ', true],
    ['an email that is not on the roster at all', 'stranger@e.org', false],
  ])('admits=%s for %s', (_case, email, admits) => {
    mockAuth.user = { email };
    renderGuard();

    expect(screen.queryByTestId('guarded-content') !== null).toBe(admits);
  });

  // ── Exception 1 (issue #1055) ────────────────────────────────────────────────
  // THIS ROW IS EXPECTED TO FLIP. The guard re-derives the signed-in member
  // itself instead of reading `membersService`'s exported `currentMember`, and
  // the two answers differ on exactly one input: a signed-out session.
  //
  //   `currentMember`  returns null when the email is falsy, before it looks.
  //   `AdminGuard`     normalises '' to '' and then matches any roster member
  //                    whose own `email` field is ''.
  //
  // So with a rogue `{ email: '', admin: true }` document on the roster, a
  // SIGNED-OUT session is currently admitted. No such document exists or can be
  // created through the app — `createMember` normalises before writing and
  // Firestore rejects an empty doc id — but nothing in the schema or the rules
  // forbids one, so this is the guard's behaviour as written today.
  //
  // Issue #1055 Phase 5 deletes the guard's copy in favour of `currentMember`,
  // at which point the answer below becomes `false` — the safer one. This test
  // is the record of what changed, and its expectation is updated in that commit.
  it('Exception 1: admits a signed-out session against an empty-email admin row', () => {
    mockAuth.user = null;
    mockMembers._set([member({ id: 'ghost', email: '', name: 'Ghost', admin: true }), KID]);
    renderGuard();

    expect(screen.getByTestId('guarded-content')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-guard-denied')).not.toBeInTheDocument();
  });

  it('denies a signed-out session when no such row exists', () => {
    mockAuth.user = null;
    renderGuard();

    expect(screen.getByTestId('admin-guard-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('guarded-content')).not.toBeInTheDocument();
  });
});
