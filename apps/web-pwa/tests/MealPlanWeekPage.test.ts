import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {
  emptyWeek,
  setDayNote,
  weekDates,
  type MealPlanWeek,
  type Member,
  type Recipe,
} from '@salt/domain';

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
  mockShopDay,
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
    // The week's shop day (issue #629) — null unless a test marks one.
    mockShopDay: makeStore<{ date: string; slot: 'am' | 'pm' } | null>(null),
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
vi.mock('../src/lib/shoppingDayService.js', () => ({
  weekShopDay: mockShopDay,
  setShopDay: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  clearShopDay: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));
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

// ─── Landing on today (#639, Phase 2) ──────────────────────────────────────
// "Today" comes from the real clock inside the component, so instead of freezing
// time these helpers build a week AROUND today at a known offset — deterministic
// on any day the suite happens to run.
const TODAY = new Date().toLocaleDateString('en-CA');

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Make a week start `offset` days before today, so today is the (offset+1)th row
// and there are exactly `offset` earlier days above it.
function weekAroundToday(offset: number): string {
  const start = addDays(TODAY, -offset);
  mockStart._set(start);
  mockWeek._set(emptyWeek(start));
  return start;
}

// ─── A fake layout for the deck (#639, Phase 4) ────────────────────────────
// The planner is no longer a scroller: it is a deck that moves a column by a
// transform. jsdom lays nothing out, so left alone the deck measures zeros —
// every stop collapses to 0 and it can never move, which would make the anchor,
// the cue and the stops all untestable (and, worse, make them look tested).
//
// So these tests install a plausible layout: a 700px viewport over seven 200px
// day cards 24px apart. Row positions are derived from the transform ACTUALLY
// applied to the column, exactly as a browser would compute them, so the real
// arithmetic in `cookDeck` runs for real against believable numbers.
const ROW_H = 200;
const ROW_GAP = 24;
const ROW_PITCH = ROW_H + ROW_GAP;
const VIEWPORT_H = 700;
const CONTENT_H = 7 * ROW_H + 6 * ROW_GAP;

function fakeRect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    y: top,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/** How far the column is currently pushed up, read back off its transform. */
function deckOffset(): number {
  const column = document.querySelector<HTMLElement>('[style*="translate3d"]');
  const match = column && /translate3d\(0(?:px)?,\s*(-?[\d.]+)px/.exec(column.style.transform);
  // `|| 0` normalises the -0 that negating "0" produces, which `toBe(0)` rejects.
  return match ? -Number(match[1]) || 0 : 0;
}

function installDeckLayout(startDate: string): void {
  const dates = weekDates(startDate);
  const realRect = Element.prototype.getBoundingClientRect;
  const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
  const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!;

  // A row wrapper is identified by the day editor it wraps.
  const rowIndex = (el: Element): number => {
    const id = el.firstElementChild?.getAttribute('data-testid') ?? '';
    return id.startsWith('day-') ? dates.indexOf(id.slice(4)) : -1;
  };
  const isViewport = (el: Element): boolean => el.getAttribute?.('data-testid') === 'week-deck';
  const isColumn = (el: Element): boolean =>
    el instanceof HTMLElement && el.style.transform.includes('translate3d');

  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (isViewport(this)) return fakeRect(0, VIEWPORT_H);
    const i = rowIndex(this);
    if (i >= 0) return fakeRect(i * ROW_PITCH - deckOffset(), ROW_H);
    return realRect.call(this);
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (rowIndex(this) >= 0) return ROW_H;
      return isColumn(this) ? CONTENT_H : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      return isViewport(this) ? VIEWPORT_H : 0;
    },
  });

  restoreLayout = () => {
    Element.prototype.getBoundingClientRect = realRect;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
    Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight);
    restoreLayout = null;
  };
}

let restoreLayout: (() => void) | null = null;

/** Render with a believable layout already in place, so the mount-time anchor measures. */
function renderLaidOut(startDate: string): void {
  installDeckLayout(startDate);
  render(MealPlanWeekPage);
}

/** Move the deck the way a keyboard user would, and wait for the spring to settle. */
async function pressDeck(key: string): Promise<void> {
  const deck = screen.getByTestId('week-deck');
  deck.focus();
  await userEvent.keyboard(`{${key}}`);
  await waitFor(() => expect(deckOffset()).toBeGreaterThan(8));
}

afterEach(() => {
  cleanup();
  restoreLayout?.();
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
  mockShopDay._set(null);
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

  it('reads the cook, who is eating and any home time off the collapsed row (#639)', () => {
    mockWeek._set({
      ...emptyWeek('2026-06-08'),
      days: {
        ...emptyWeek('2026-06-08').days,
        '2026-06-08': {
          note: 'Roast',
          recipeIds: [],
          chefs: ['bob@e.org'],
          attendees: [
            { memberId: 'alice@e.org', homeTime: '18:00', note: 'late' },
            { memberId: 'bob@e.org', homeTime: null, note: '' },
          ],
          guests: 0,
        },
      },
    });
    render(MealPlanWeekPage);
    const meta = screen.getByTestId('day-2026-06-08-meta');
    expect(meta.textContent).toContain('Bob cooking');
    // Both members are eating, so the roster collapses to one word…
    expect(meta.textContent).toContain('Everyone');
    // …and only Alice's time is set, so only Alice's shows.
    expect(meta.textContent).toContain('Alice 18:00');
    expect(meta.textContent).not.toContain('Bob 1');
  });

  it('marks the shop day with a labelled rule across the list (#639)', () => {
    mockShopDay._set({ date: '2026-06-10', slot: 'am' });
    render(MealPlanWeekPage);
    const rule = screen.getByTestId('day-2026-06-10-shop-marker');
    expect(rule).toHaveTextContent('Shop');
    expect(rule).toHaveTextContent('am');
    // Exactly one rule, on the shop day only.
    expect(screen.queryByTestId('day-2026-06-08-shop-marker')).not.toBeInTheDocument();
    // …and the rule is a sibling of the rows, not a badge inside one.
    expect(screen.getByTestId('day-2026-06-10').contains(rule)).toBe(false);
  });

  it('draws no rule when the week has no shop day', () => {
    render(MealPlanWeekPage);
    expect(screen.queryByTestId('day-2026-06-10-shop-marker')).not.toBeInTheDocument();
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

describe('MealPlanWeekPage — landing on today (#639, Phases 2 & 4)', () => {
  it("opens with today's row at the top of the deck", async () => {
    const start = weekAroundToday(3);
    renderLaidOut(start);

    // Today is the fourth row, so the deck starts three pitches down — today sits
    // flush under the header rather than wherever the Friday-start week left it.
    await waitFor(() => expect(deckOffset()).toBe(3 * ROW_PITCH));
  });

  it('lands another week at the top instead, and never shows the pill there', async () => {
    const start = addDays(TODAY, -30);
    mockStart._set(start);
    mockWeek._set(emptyWeek(start));
    renderLaidOut(start);

    expect(screen.getByTestId(`day-${start}`)).toBeInTheDocument();
    expect(deckOffset()).toBe(0);
    expect(screen.queryByTestId('earlier-days')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scroll-shadow')).not.toBeInTheDocument();

    // Even moved, a week without today has no earlier-days pill — only the header
    // shadow, which is about position in the list, not about today.
    await pressDeck('ArrowDown');
    await waitFor(() => expect(screen.getByTestId('scroll-shadow')).toBeInTheDocument());
    expect(screen.queryByTestId('earlier-days')).not.toBeInTheDocument();
  });

  it('names the earlier days once the deck has left the top', async () => {
    const start = weekAroundToday(3);
    renderLaidOut(start);

    // Landing mid-list IS the reason the cue exists, so it is there on arrival.
    const pill = await screen.findByTestId('earlier-days');
    expect(pill).toHaveTextContent('3 earlier days');
    expect(screen.getByTestId('scroll-shadow')).toBeInTheDocument();
  });

  it('takes you back up to the earlier days when the pill is tapped', async () => {
    const start = weekAroundToday(2);
    renderLaidOut(start);

    await userEvent.click(await screen.findByTestId('earlier-days'));

    // The spring carries it home, and the cue withdraws once it arrives.
    await waitFor(() => expect(deckOffset()).toBe(0));
    await waitFor(() => expect(screen.queryByTestId('earlier-days')).not.toBeInTheDocument());
    expect(screen.queryByTestId('scroll-shadow')).not.toBeInTheDocument();
  });

  it('counts one earlier day in the singular', async () => {
    const start = weekAroundToday(1);
    renderLaidOut(start);
    expect(await screen.findByTestId('earlier-days')).toHaveTextContent('1 earlier day');
  });

  it('shows no pill when today is the first day of the week', async () => {
    const start = weekAroundToday(0);
    renderLaidOut(start);

    expect(deckOffset()).toBe(0);
    expect(screen.queryByTestId('earlier-days')).not.toBeInTheDocument();
    // Moving off the top earns the shadow, but there is still nothing above today.
    await pressDeck('ArrowDown');
    expect(screen.queryByTestId('earlier-days')).not.toBeInTheDocument();
  });

  it('moves day to day under the arrow keys', async () => {
    const start = weekAroundToday(0);
    renderLaidOut(start);

    await pressDeck('ArrowDown');
    // One press, one day — the stops are the day headers, not arbitrary pixels.
    await waitFor(() => expect(deckOffset()).toBe(ROW_PITCH));
  });

  it('renders the days already behind us a step quieter', () => {
    const start = weekAroundToday(3);
    renderLaidOut(start);

    const quietness = (date: string): string =>
      screen.getByTestId(`day-${date}`).parentElement?.className ?? '';
    const dates = weekDates(start);
    // The three days before today read as looking backwards…
    expect(quietness(dates[0]!)).toContain('opacity-60');
    expect(quietness(dates[2]!)).toContain('opacity-60');
    // …today and everything ahead of it stay at full strength.
    expect(quietness(TODAY)).not.toContain('opacity-60');
    expect(quietness(dates[6]!)).not.toContain('opacity-60');
  });

  it('leaves every day at full strength in a week that is not this one', () => {
    const start = addDays(TODAY, -30);
    mockStart._set(start);
    mockWeek._set(emptyWeek(start));
    renderLaidOut(start);

    for (const date of weekDates(start)) {
      expect(screen.getByTestId(`day-${date}`).parentElement?.className ?? '').not.toContain(
        'opacity-60',
      );
    }
  });
});
