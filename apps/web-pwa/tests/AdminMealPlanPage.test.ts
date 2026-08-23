import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { emptyTemplate, setDayNote, type MealPlanTemplate, type Member } from '@salt/domain';

const { mockMembers, mockIsLoadingMembers, mockTemplate, mockFirstDay, mockAuth } = vi.hoisted(
  () => {
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
      mockIsLoadingMembers: makeStore<boolean>(false),
      mockTemplate: makeStore<MealPlanTemplate | null>(null),
      mockFirstDay: makeStore<string>('mon'),
      mockAuth: { user: { email: 'admin@e.org' } as { email: string } | null },
    };
  },
);

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({ auth: mockAuth }));
vi.mock('../src/lib/membersService.js', () => ({
  members: mockMembers,
  isLoadingMembers: mockIsLoadingMembers,
}));
vi.mock('../src/lib/mealPlanService.js', () => ({
  mealPlanTemplate: mockTemplate,
  firstDayOfWeek: mockFirstDay,
  saveFirstDayOfWeek: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setTemplateDayNote: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setTemplateDayChefs: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setTemplateDayGuests: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  addTemplateAttendee: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  removeTemplateAttendee: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setTemplateAttendeeHomeTime: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setTemplateAttendeeNote: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import AdminMealPlanPage from '../src/routes/admin/AdminMealPlanPage.svelte';
import { saveFirstDayOfWeek, setTemplateDayNote } from '../src/lib/mealPlanService.js';

function member(id: string, name: string, admin = false): Member {
  return {
    id,
    schemaVersion: 1,
    name,
    email: id,
    admin,
    sortOrder: 0,
    icon: null,
    cookMode: 'standard',
    updatedAt: '2026-06-07T00:00:00.000Z',
  };
}

const ADMIN = member('admin@e.org', 'Ada Admin', true);

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = { email: 'admin@e.org' };
  mockIsLoadingMembers._set(false);
  mockMembers._set([ADMIN]);
  mockFirstDay._set('mon');
  mockTemplate._set(emptyTemplate());
});

describe('AdminMealPlanPage', () => {
  it('renders the first-day setting and seven weekday rows', () => {
    render(AdminMealPlanPage);
    expect(screen.getByTestId('first-day-setting')).toBeInTheDocument();
    expect(screen.getByTestId('tmpl-mon')).toBeInTheDocument();
    expect(screen.getByTestId('tmpl-sun')).toBeInTheDocument();
  });

  it("edits a weekday template note through the service after opening the day's sheet", async () => {
    render(AdminMealPlanPage);
    await userEvent.click(screen.getByTestId('tmpl-fri-summary'));
    await userEvent.type(screen.getByTestId('tmpl-fri-note'), 'Pizza');
    await waitFor(() => expect(vi.mocked(setTemplateDayNote)).toHaveBeenCalled());
    expect(vi.mocked(setTemplateDayNote).mock.calls[0]![0]).toBe('fri');
  });

  it("reflects an existing template note in the day's sheet", async () => {
    mockTemplate._set(setDayNote(emptyTemplate(), 'mon', 'Roast'));
    render(AdminMealPlanPage);
    await userEvent.click(screen.getByTestId('tmpl-mon-summary'));
    expect((screen.getByTestId('tmpl-mon-note') as HTMLInputElement).value).toBe('Roast');
  });

  // The template editor gets the same sheet as the planner (#640, Phase 1), but
  // it has no dates — so its title is the weekday alone, from the `label` the row
  // already carries. It passes no `sheetTitle`, and that is the whole difference.
  it('opens the weekday in a sheet titled with the weekday alone', async () => {
    render(AdminMealPlanPage);
    await userEvent.click(screen.getByTestId('tmpl-wed-summary'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(screen.getByTestId('tmpl-wed-detail'));
    expect(screen.getByRole('heading', { name: 'Wednesday' })).toBeInTheDocument();
    // Recipe-free and shop-free: the template passes neither handler, and the
    // move into a sheet did not change that gating.
    expect(screen.queryByTestId('tmpl-wed-recipes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tmpl-wed-shop')).not.toBeInTheDocument();
  });

  it('opens one weekday at a time', async () => {
    render(AdminMealPlanPage);
    await userEvent.click(screen.getByTestId('tmpl-mon-summary'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('tmpl-mon-detail')).not.toBeInTheDocument());
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(''));

    await userEvent.click(screen.getByTestId('tmpl-tue-summary'));
    expect(screen.getByTestId('tmpl-tue-detail')).toBeInTheDocument();
    expect(screen.queryByTestId('tmpl-mon-detail')).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('saves a new first-day-of-week selection', async () => {
    render(AdminMealPlanPage);
    // Open the select and choose Saturday (options render with role="option").
    await userEvent.click(screen.getByTestId('first-day-trigger'));
    await waitFor(() => screen.getByRole('option', { name: 'Saturday' }));
    await userEvent.click(screen.getByRole('option', { name: 'Saturday' }));
    await waitFor(() => expect(vi.mocked(saveFirstDayOfWeek)).toHaveBeenCalledWith('sat'));
  });

  it('denies a non-admin', async () => {
    mockAuth.user = { email: 'kid@e.org' };
    mockMembers._set([ADMIN, member('kid@e.org', 'Kid')]);
    render(AdminMealPlanPage);
    await waitFor(() => expect(screen.queryByTestId('admin-mealplan')).not.toBeInTheDocument());
  });
});
