import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { emptyWeek, setDayNote, type MealPlanWeek, type Member, type Recipe } from '@salt/domain';

// A minimal recipe. MealDayEditor's picker/auto-fill read `id`/`title`; the add-to-
// shop sheet also reads `metadata.servings` (seed) — the plan builder is mocked, so
// the ingredient detail is irrelevant here.
const RECIPE: Recipe = {
  id: 'r1',
  title: 'Spaghetti Bolognese',
  metadata: { servings: 2 },
  ingredients: [],
} as unknown as Recipe;

// ─── Hoisted reactive stubs ────────────────────────────────────────────────
const {
  mockMembers,
  mockWeek,
  mockStart,
  mockLoading,
  mockRecipes,
  mockCanonItems,
  mockDefaultListId,
  mockBuildRecipeAddPlan,
  mockCommitRecipeAddPlan,
  mockRecipeAddPlanItemCount,
} = vi.hoisted(() => {
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
    mockRecipes: makeStore<readonly Recipe[]>([
      { id: 'r1', title: 'Spaghetti Bolognese' } as unknown as Recipe,
    ]),
    mockCanonItems: makeStore<unknown[]>([]),
    mockDefaultListId: makeStore<string | null>('list-1'),
    // A one-row plan is enough for the sheet to render and confirm.
    mockBuildRecipeAddPlan: vi.fn(() => [
      {
        ingredientId: 'i1',
        name: 'Spaghetti',
        fromCanon: false,
        amount: undefined,
        unit: undefined,
        isOptional: false,
        make: false,
        producers: [],
        producerId: null,
        madeServings: 1,
        add: true,
        check: false,
        subRows: null,
      },
    ]),
    mockCommitRecipeAddPlan: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
    mockRecipeAddPlanItemCount: vi.fn(() => 1),
  };
});

vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/membersService.js', () => ({ members: mockMembers }));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  buildRecipeAddPlan: mockBuildRecipeAddPlan,
  buildMadeSubRows: vi.fn(() => []),
  commitRecipeAddPlan: mockCommitRecipeAddPlan,
  recipeAddPlanItemCount: mockRecipeAddPlanItemCount,
}));
vi.mock('../src/lib/canonService.js', () => ({ canonItems: mockCanonItems }));
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({ defaultListId: mockDefaultListId }));
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
  setWeekDayRecipes: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
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
  setWeekDayChefs,
  setWeekDayRecipes,
  addWeekAttendee,
  setWeekAttendeeHomeTime,
} from '../src/lib/mealPlanService.js';
import { addToast } from '../src/lib/toastStore.js';

// A week whose single day already has recipe r1 attached, so its detail renders a
// recipe row (with the per-row "Add to shop" action) without going through the
// picker (setWeekDayRecipes is a no-op mock and never updates the store).
function weekWithRecipe(date: string): MealPlanWeek {
  return {
    ...emptyWeek(date),
    days: {
      ...emptyWeek(date).days,
      [date]: { note: '', recipeIds: ['r1'], chefs: [], attendees: [], guests: 0 },
    },
  };
}

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
  mockRecipes._set([RECIPE]);
  mockCanonItems._set([]);
  mockDefaultListId._set('list-1');
});

// Attach a recipe through the day's real recipe-picker Combobox: click the input
// to open the listbox, then click the option by its title.
async function attachRecipe(date: string, title: string): Promise<void> {
  await userEvent.click(screen.getByTestId(`day-${date}-recipe-picker`));
  await userEvent.click(await screen.findByRole('option', { name: title }));
}

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
    // The home-time picker is a Select; choosing "No time" clears it to null.
    const timeTrigger = await screen.findByTestId('day-2026-06-08-time-alice@e.org');
    await userEvent.click(timeTrigger);
    await waitFor(() => screen.getByRole('option', { name: 'No time' }));
    await userEvent.click(screen.getByRole('option', { name: 'No time' }));
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

  it('shows home time and a per-attendee note badge on the collapsed row', () => {
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
    // Alice has a note, so her avatar carries the note badge; Bob's does not.
    expect(screen.getByTestId('day-2026-06-08-note-badge-alice@e.org')).toBeInTheDocument();
    expect(screen.queryByTestId('day-2026-06-08-note-badge-bob@e.org')).not.toBeInTheDocument();
  });

  it('omits the note badge when an attendee has no note', () => {
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
    expect(screen.queryByTestId('day-2026-06-08-note-badge-alice@e.org')).not.toBeInTheDocument();
  });

  it('splits into hour + quarter-hour minute, seeded to the dinner default', async () => {
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
    const hourTrigger = screen.getByTestId('day-2026-06-08-time-alice@e.org');
    const minuteTrigger = screen.getByTestId('day-2026-06-08-time-min-alice@e.org');
    // A blank home time reads as placeholders; nothing is persisted until a pick.
    expect(hourTrigger).toHaveTextContent('HH');
    expect(minuteTrigger).toHaveTextContent('MM');
    expect(vi.mocked(setWeekAttendeeHomeTime)).not.toHaveBeenCalled();

    // The minute list offers only quarter-hours — no scrolling through 60 values.
    await userEvent.click(minuteTrigger);
    await waitFor(() => screen.getByRole('option', { name: '15' }));
    expect(screen.queryByRole('option', { name: '10' })).not.toBeInTheDocument();
    // Picking a minute from blank persists HH:MM, defaulting the untouched hour to
    // the dinner-time seed (18) — so a single pick still yields a whole time.
    await userEvent.click(screen.getByRole('option', { name: '15' }));
    await waitFor(() =>
      expect(vi.mocked(setWeekAttendeeHomeTime)).toHaveBeenCalledWith(
        '2026-06-08',
        'alice@e.org',
        '18:15',
      ),
    );
  });

  it('lets a non-attending member be set as chef', async () => {
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    // Alice is not attending; the Chef toggle is still present and works.
    await userEvent.click(screen.getByTestId('day-2026-06-08-chef-alice@e.org'));
    expect(vi.mocked(setWeekDayChefs)).toHaveBeenCalledWith('2026-06-08', ['alice@e.org']);
  });

  it('chef toggle styling reacts to selection state', async () => {
    const chefDay = (chefs: string[]) => ({
      ...emptyWeek('2026-06-08'),
      days: {
        ...emptyWeek('2026-06-08').days,
        '2026-06-08': { note: '', recipeIds: [], chefs, attendees: [], guests: 0 },
      },
    });
    mockWeek._set(chefDay(['alice@e.org']));
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    const btn = screen.getByTestId('day-2026-06-08-chef-alice@e.org');
    expect(btn.className).toContain('bg-amber-500');

    // Deselecting (chefs back to empty) must drop the selected colour.
    mockWeek._set(chefDay([]));
    await waitFor(() => expect(btn.className).not.toContain('bg-amber-500'));
  });

  it('adjusts the guest count through the service', async () => {
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    await userEvent.click(screen.getByTestId('day-2026-06-08-guests-inc'));
    expect(vi.mocked(setWeekDayGuests)).toHaveBeenCalledWith('2026-06-08', 1);
  });

  it('auto-fills an empty meal with the attached recipe title (Phase 3, #469)', async () => {
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    await attachRecipe('2026-06-08', 'Spaghetti Bolognese');
    // The recipe is stored…
    expect(vi.mocked(setWeekDayRecipes)).toHaveBeenCalledWith('2026-06-08', ['r1']);
    // …and the empty meal note is auto-filled with the recipe's title.
    await waitFor(() =>
      expect(vi.mocked(setWeekDayNote)).toHaveBeenCalledWith('2026-06-08', 'Spaghetti Bolognese'),
    );
  });

  it('does not overwrite a non-empty meal when a recipe is attached (Phase 3, #469)', async () => {
    mockWeek._set({
      ...emptyWeek('2026-06-08'),
      days: {
        ...emptyWeek('2026-06-08').days,
        '2026-06-08': {
          note: 'My own dinner',
          recipeIds: [],
          chefs: [],
          attendees: [],
          guests: 0,
        },
      },
    });
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    await attachRecipe('2026-06-08', 'Spaghetti Bolognese');
    // The recipe still attaches…
    expect(vi.mocked(setWeekDayRecipes)).toHaveBeenCalledWith('2026-06-08', ['r1']);
    // …but the typed meal is left untouched — the note is never rewritten.
    expect(vi.mocked(setWeekDayNote)).not.toHaveBeenCalled();
  });

  it('adds an attached recipe to the shopping list from the day detail (Phase 4, #469)', async () => {
    mockWeek._set(weekWithRecipe('2026-06-08'));
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');

    // The attached recipe row carries a per-row "Add to shop" action.
    await userEvent.click(screen.getByTestId('day-2026-06-08-recipe-addshop-r1'));

    // The familiar review sheet opens for that recipe…
    const confirm = await screen.findByTestId('recipe-add-to-list-confirm');
    expect(screen.getByTestId('recipe-add-review-list')).toBeInTheDocument();

    // …and confirming commits the plan to the default list via the shared writer.
    await userEvent.click(confirm);
    await waitFor(() => expect(vi.mocked(mockCommitRecipeAddPlan)).toHaveBeenCalled());
    const [recipeArg, listIdArg] = vi.mocked(mockCommitRecipeAddPlan).mock.calls[0]!;
    expect((recipeArg as Recipe).id).toBe('r1');
    expect(listIdArg).toBe('list-1');
  });

  it('shows the friendly toast and does not open the sheet with no default list (Phase 4, #469)', async () => {
    mockDefaultListId._set(null);
    mockWeek._set(weekWithRecipe('2026-06-08'));
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');

    await userEvent.click(screen.getByTestId('day-2026-06-08-recipe-addshop-r1'));

    expect(vi.mocked(addToast)).toHaveBeenCalledWith(
      'No shopping list found. Create one first.',
      'destructive',
    );
    // The guard blocks the sheet: no review list is mounted, nothing is committed.
    expect(screen.queryByTestId('recipe-add-review-list')).not.toBeInTheDocument();
    expect(vi.mocked(mockCommitRecipeAddPlan)).not.toHaveBeenCalled();
  });

  it('shows a spinner while the week is loading', () => {
    mockLoading._set(true);
    render(MealPlanWeekPage);
    // ListPage renders its loading state; the day rows are absent.
    expect(screen.queryByTestId('day-2026-06-08')).not.toBeInTheDocument();
  });
});
