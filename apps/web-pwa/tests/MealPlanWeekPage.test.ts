import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { emptyWeek, setDayNote, type MealPlanWeek, type Member } from '@salt/domain';

// ─── Hoisted reactive stubs ────────────────────────────────────────────────
const { mockMembers, mockWeek, mockStart, mockLoading } = vi.hoisted(() => {
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
    mockWeek: makeStore<MealPlanWeek>({
      id: '',
      schemaVersion: 1,
      startDate: '',
      days: {},
      updatedAt: '',
    }),
    mockStart: makeStore<string>('2026-06-08'),
    mockLoading: makeStore<boolean>(false),
  };
});

vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/membersService.js', () => ({ members: mockMembers }));
vi.mock('../src/lib/mealPlanService.js', () => ({
  currentWeek: mockWeek,
  selectedStartDate: mockStart,
  isLoadingMealPlanWeek: mockLoading,
  nextWeek: vi.fn(),
  prevWeek: vi.fn(),
  thisWeek: vi.fn(),
  loadTemplateIntoCurrentWeek: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setWeekDayNote: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setWeekDayChefs: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setWeekDayGuests: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  addWeekAttendee: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  removeWeekAttendee: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setWeekAttendeeHomeTime: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  setWeekAttendeeNote: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

import MealPlanWeekPage from '../src/routes/mealplan/MealPlanWeekPage.svelte';
import {
  nextWeek,
  prevWeek,
  loadTemplateIntoCurrentWeek,
  setWeekDayNote,
  setWeekDayGuests,
  addWeekAttendee,
  setWeekAttendeeHomeTime,
} from '../src/lib/mealPlanService.js';

async function expandDay(date: string): Promise<void> {
  await userEvent.click(screen.getByTestId(`day-${date}-summary`));
}

function member(id: string, name: string): Member {
  return {
    id,
    schemaVersion: 1,
    name,
    email: id,
    admin: false,
    sortOrder: 0,
    icon: null,
    updatedAt: '2026-06-07T00:00:00.000Z',
  };
}

const ALICE = member('alice@e.org', 'Alice');
const BOB = member('bob@e.org', 'Bob');

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockMembers._set([ALICE, BOB]);
  mockStart._set('2026-06-08');
  mockLoading._set(false);
  mockWeek._set(emptyWeek('2026-06-08'));
});

describe('MealPlanWeekPage', () => {
  it('renders seven collapsed day rows and the week range', () => {
    render(MealPlanWeekPage);
    expect(screen.getByTestId('day-2026-06-08')).toBeInTheDocument();
    expect(screen.getByTestId('day-2026-06-14')).toBeInTheDocument();
    expect(screen.getByTestId('week-range').textContent).toContain('Jun');
    // Detail is hidden until a day is expanded.
    expect(screen.queryByTestId('day-2026-06-08-detail')).not.toBeInTheDocument();
  });

  it('navigates with prev/next', async () => {
    render(MealPlanWeekPage);
    await userEvent.click(screen.getByLabelText('Next week'));
    expect(vi.mocked(nextWeek)).toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('Previous week'));
    expect(vi.mocked(prevWeek)).toHaveBeenCalled();
  });

  it('edits a meal note through the service after expanding the day', async () => {
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    const noteInput = screen.getByTestId('day-2026-06-08-note');
    await userEvent.type(noteInput, 'Pasta');
    await waitFor(() => expect(vi.mocked(setWeekDayNote)).toHaveBeenCalled());
    expect(vi.mocked(setWeekDayNote).mock.calls[0]![0]).toBe('2026-06-08');
  });

  it('toggles an attendee and reveals a savable blank home-time', async () => {
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    const attendWrap = screen.getByTestId('day-2026-06-08-attend-alice@e.org');
    await userEvent.click(within(attendWrap).getByRole('checkbox'));
    expect(vi.mocked(addWeekAttendee)).toHaveBeenCalledWith(
      '2026-06-08',
      expect.objectContaining({ memberId: 'alice@e.org', homeTime: null }),
    );

    // With Alice attending, the home-time input appears; leaving it blank saves null.
    mockWeek._set({
      ...emptyWeek('2026-06-08'),
      days: {
        ...emptyWeek('2026-06-08').days,
        '2026-06-08': {
          note: '',
          recipeIds: [],
          chefs: [],
          attendees: [{ memberId: 'alice@e.org', homeTime: '18:00', note: '' }],
          guests: 0,
        },
      },
    });
    const timeInput = (await screen.findByTestId(
      'day-2026-06-08-time-alice@e.org',
    )) as HTMLInputElement;
    await userEvent.clear(timeInput);
    await waitFor(() =>
      expect(vi.mocked(setWeekAttendeeHomeTime)).toHaveBeenCalledWith(
        '2026-06-08',
        'alice@e.org',
        null,
      ),
    );
  });

  it('loads the template directly for an unedited week (no confirm)', async () => {
    render(MealPlanWeekPage);
    await userEvent.click(screen.getByTestId('load-template'));
    expect(vi.mocked(loadTemplateIntoCurrentWeek)).toHaveBeenCalled();
  });

  it('confirms before overwriting an already-edited week', async () => {
    mockWeek._set(
      setDayNote(
        { ...emptyWeek('2026-06-08'), updatedAt: '2026-06-08T00:00:00.000Z' },
        '2026-06-08',
        'edited',
      ),
    );
    render(MealPlanWeekPage);
    await userEvent.click(screen.getByTestId('load-template'));
    await waitFor(() => screen.getByTestId('load-template-confirm'));
    expect(vi.mocked(loadTemplateIntoCurrentWeek)).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('load-template-confirm-btn'));
    expect(vi.mocked(loadTemplateIntoCurrentWeek)).toHaveBeenCalled();
  });

  it('renders an unknown attendee as removable in the detail panel', async () => {
    mockWeek._set({
      ...emptyWeek('2026-06-08'),
      days: {
        ...emptyWeek('2026-06-08').days,
        '2026-06-08': {
          note: '',
          recipeIds: [],
          chefs: [],
          attendees: [{ memberId: 'gone@e.org', homeTime: null, note: '' }],
          guests: 0,
        },
      },
    });
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    expect(screen.getByTestId('day-2026-06-08-unknown-gone@e.org')).toBeInTheDocument();
  });

  it('shows home time and a note indicator on the collapsed row', () => {
    mockWeek._set({
      ...emptyWeek('2026-06-08'),
      days: {
        ...emptyWeek('2026-06-08').days,
        '2026-06-08': {
          note: 'Roast',
          recipeIds: [],
          chefs: [],
          attendees: [
            { memberId: 'alice@e.org', homeTime: '18:00', note: 'late' },
            { memberId: 'bob@e.org', homeTime: null, note: '' },
          ],
          guests: 0,
        },
      },
    });
    render(MealPlanWeekPage);
    const summary = screen.getByTestId('day-2026-06-08-summary');
    // Alice's time shows; Bob's blank time shows nothing.
    expect(summary.textContent).toContain('18:00');
    // A note exists, so the indicator is present.
    expect(screen.getByTestId('day-2026-06-08-note-indicator')).toBeInTheDocument();
  });

  it('omits the note indicator when no attendee has a note', () => {
    mockWeek._set({
      ...emptyWeek('2026-06-08'),
      days: {
        ...emptyWeek('2026-06-08').days,
        '2026-06-08': {
          note: 'Roast',
          recipeIds: [],
          chefs: [],
          attendees: [{ memberId: 'alice@e.org', homeTime: '18:00', note: '' }],
          guests: 0,
        },
      },
    });
    render(MealPlanWeekPage);
    expect(screen.queryByTestId('day-2026-06-08-note-indicator')).not.toBeInTheDocument();
  });

  it('seeds the time picker from 18:30 when blank, without persisting on cancel', async () => {
    mockWeek._set({
      ...emptyWeek('2026-06-08'),
      days: {
        ...emptyWeek('2026-06-08').days,
        '2026-06-08': {
          note: '',
          recipeIds: [],
          chefs: [],
          attendees: [{ memberId: 'alice@e.org', homeTime: null, note: '' }],
          guests: 0,
        },
      },
    });
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    const timeInput = screen.getByTestId('day-2026-06-08-time-alice@e.org') as HTMLInputElement;
    expect(timeInput.value).toBe('');

    await fireEvent.focus(timeInput);
    expect(timeInput.value).toBe('18:30');
    // Focus alone does not persist anything.
    expect(vi.mocked(setWeekAttendeeHomeTime)).not.toHaveBeenCalled();

    // Blurring without picking re-syncs back to the committed blank value.
    await fireEvent.blur(timeInput);
    expect(timeInput.value).toBe('');
  });

  it('adjusts the guest count through the service', async () => {
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    await userEvent.click(screen.getByTestId('day-2026-06-08-guests-inc'));
    expect(vi.mocked(setWeekDayGuests)).toHaveBeenCalledWith('2026-06-08', 1);
  });

  it('shows a spinner while the week is loading', () => {
    mockLoading._set(true);
    render(MealPlanWeekPage);
    // ListPage renders its loading state; the day rows are absent.
    expect(screen.queryByTestId('day-2026-06-08')).not.toBeInTheDocument();
  });
});
