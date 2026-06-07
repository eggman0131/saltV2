import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Member } from '@salt/domain';

const { mockMembers, mockIsLoading, mockAuth } = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) {
        subs.add(fn);
        fn(value);
        return () => {
          subs.delete(fn);
        };
      },
      _set(v: T) {
        value = v;
        subs.forEach((fn) => fn(v));
      },
    };
  }
  return {
    mockMembers: makeStore<Member[]>([]),
    mockIsLoading: makeStore<boolean>(false),
    mockAuth: { user: { email: 'admin@e.org' } as { email: string } | null },
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));
vi.mock('../src/lib/membersService.js', () => ({
  members: mockMembers,
  isLoadingMembers: mockIsLoading,
  createMemberEntry: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  updateMemberEntry: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteMemberEntry: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import AdminMembersPage from '../src/routes/admin/AdminMembersPage.svelte';
import { push } from 'svelte-spa-router';
import {
  createMemberEntry,
  updateMemberEntry,
  deleteMemberEntry,
} from '../src/lib/membersService.js';

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

const ADMIN = member({ id: 'admin@e.org', name: 'Ada Admin', admin: true, sortOrder: 0 });

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { email: 'admin@e.org' };
  mockIsLoading._set(false);
  mockMembers._set([ADMIN]);
});

describe('AdminMembersPage — admin access', () => {
  it('renders a row per member with name, email and admin badge', () => {
    mockMembers._set([ADMIN, member({ id: 'kid@e.org', name: 'Kid' })]);
    render(AdminMembersPage);
    const rows = screen.getAllByTestId('member-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText('kid@e.org')).toBeInTheDocument();
    expect(screen.getAllByTestId('member-admin-badge')).toHaveLength(1);
  });

  it('opens the editor and creates a member', async () => {
    render(AdminMembersPage);
    await userEvent.click(screen.getByTestId('member-add'));
    await waitFor(() => screen.getByTestId('member-editor'));

    await userEvent.type(screen.getByTestId('member-name-input'), 'New Person');
    await userEvent.type(screen.getByTestId('member-email-input'), 'new@e.org');
    await userEvent.click(screen.getByTestId('member-save'));

    await waitFor(() => {
      expect(vi.mocked(createMemberEntry)).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Person', email: 'new@e.org', admin: false }),
      );
    });
  });

  it('edits an existing member (email field disabled)', async () => {
    mockMembers._set([ADMIN, member({ id: 'kid@e.org', name: 'Kid', sortOrder: 1 })]);
    render(AdminMembersPage);

    const kidRow = screen.getByText('kid@e.org').closest('[data-testid="member-row"]')!;
    const editBtn = [...kidRow.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Edit'),
    )!;
    await userEvent.click(editBtn);

    await waitFor(() => screen.getByTestId('member-editor'));
    expect(screen.getByTestId('member-email-input')).toBeDisabled();

    await userEvent.click(screen.getByTestId('member-save'));
    await waitFor(() => {
      expect(vi.mocked(updateMemberEntry)).toHaveBeenCalledWith(
        'kid@e.org',
        expect.objectContaining({ name: 'Kid' }),
      );
    });
  });

  it('removes a member after confirmation', async () => {
    mockMembers._set([ADMIN, member({ id: 'kid@e.org', name: 'Kid', sortOrder: 1 })]);
    render(AdminMembersPage);

    const kidRow = screen.getByText('kid@e.org').closest('[data-testid="member-row"]')!;
    const removeBtn = [...kidRow.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Remove'),
    )!;
    await userEvent.click(removeBtn);

    await waitFor(() => screen.getByTestId('member-delete-dialog'));
    await userEvent.click(screen.getByTestId('member-delete-confirm'));

    await waitFor(() => {
      expect(vi.mocked(deleteMemberEntry)).toHaveBeenCalledWith('kid@e.org');
    });
  });
});

describe('AdminMembersPage — non-admin guard', () => {
  it('denies a non-admin and redirects home', async () => {
    mockAuth.user = { email: 'kid@e.org' };
    mockMembers._set([ADMIN, member({ id: 'kid@e.org', name: 'Kid' })]);
    render(AdminMembersPage);

    await waitFor(() => expect(vi.mocked(push)).toHaveBeenCalledWith('/'));
    expect(screen.queryByTestId('members-list')).not.toBeInTheDocument();
  });

  it('shows a spinner while the roster is still loading', () => {
    mockIsLoading._set(true);
    render(AdminMembersPage);
    expect(screen.getByTestId('admin-guard-loading')).toBeInTheDocument();
    expect(vi.mocked(push)).not.toHaveBeenCalled();
  });
});
