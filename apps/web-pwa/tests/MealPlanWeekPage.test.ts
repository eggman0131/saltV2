import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {
  emptyWeek,
  templateWeekStarts,
  weekDates,
  weekdayOf,
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

// The other two kinds (#637). Neither carries ingredients or steps: what the
// planner does with them is decided by the domain capability predicates, not by
// their contents. RECIPE deliberately has NO `kind` field — a pre-#637 document
// — so every assertion below also proves the `kindOf` default still reads as a
// recipe.
const OUTING: Recipe = {
  id: 'o1',
  title: 'Takeaway — Indian',
  kind: 'outing',
  metadata: { servings: 2 },
  ingredients: [],
} as unknown as Recipe;

const COCKTAIL: Recipe = {
  id: 'c1',
  title: 'Negroni',
  kind: 'cocktail',
  metadata: { servings: 1 },
  ingredients: [],
} as unknown as Recipe;

// ─── Hoisted reactive stubs ────────────────────────────────────────────────
const {
  mockMembers,
  mockWeek,
  mockStart,
  mockLoading,
  mockFirstDay,
  mockExtensionWeek,
  mockExtensionStart,
  mockSetExtensionWeek,
  mockRecipes,
  mockCanonItems,
  mockDefaultListId,
  mockShopDay,
  mockExtensionShopDay,
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
  // Start date of the second week the planner is holding, '' for none. The real
  // service owns this; here `setExtensionWeek` drives it, so the page's own
  // request for a second week is what makes one appear — exactly the loop the
  // feature runs on.
  const extensionStart = makeStore<string>('');
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
    // The household's first day of the week — what makes "the last two days of
    // the cycle" land on a Wednesday in production.
    mockFirstDay: makeStore<string>('mon'),
    mockExtensionWeek: makeStore<MealPlanWeek | null>(null),
    mockExtensionStart: extensionStart,
    mockSetExtensionWeek: vi.fn((start: string | null) => extensionStart._set(start ?? '')),
    mockRecipes: makeStore<readonly Recipe[]>([
      { id: 'r1', title: 'Spaghetti Bolognese' } as unknown as Recipe,
    ]),
    mockCanonItems: makeStore<unknown[]>([]),
    mockDefaultListId: makeStore<string | null>('list-1'),
    // The week's shop day (issue #629) — null unless a test marks one.
    mockShopDay: makeStore<{ date: string; slot: 'am' | 'pm' } | null>(null),
    // Next week's shop day, when the planner is showing next week too (#639).
    mockExtensionShopDay: makeStore<{ date: string; slot: 'am' | 'pm' } | null>(null),
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
  extensionWeekShopDay: mockExtensionShopDay,
  setShopDay: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  clearShopDay: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));
vi.mock('../src/lib/mealPlanService.js', () => ({
  currentWeek: mockWeek,
  selectedStartDate: mockStart,
  isLoadingMealPlanWeek: mockLoading,
  firstDayOfWeek: mockFirstDay,
  extensionWeek: mockExtensionWeek,
  extensionStartDate: mockExtensionStart,
  setExtensionWeek: mockSetExtensionWeek,
  nextWeek: vi.fn(),
  prevWeek: vi.fn(),
  thisWeek: vi.fn(),
  goToWeek: vi.fn(),
  loadTemplateIntoWeek: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  // "Does that week already hold edits?", asked once per offered week when the
  // load-template picker opens. Clear by default; tests that care override it.
  weekHasEdits: vi.fn().mockResolvedValue({ kind: 'ok', value: false }),
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
  goToWeek,
  loadTemplateIntoWeek,
  weekHasEdits,
  setWeekDayNote,
  setWeekDayGuests,
  setWeekDayChefs,
  setWeekDayRecipes,
  addWeekAttendee,
  setWeekAttendeeHomeTime,
} from '../src/lib/mealPlanService.js';
import { addToast } from '../src/lib/toastStore.js';

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
// and there are exactly `offset` earlier days above it. `firstDayOfWeek` is set to
// match, so the displayed week really IS today's cycle — which is what decides
// whether next week is appended (#639, Phase 6).
function weekAroundToday(offset: number): string {
  const start = addDays(TODAY, -offset);
  mockStart._set(start);
  mockWeek._set(emptyWeek(start));
  mockFirstDay._set(weekdayOf(start));
  return start;
}

// The same, plus next week seeded and ready for the page to ask for it. Returns
// both start dates.
function weekAroundTodayWithNext(offset: number): { start: string; next: string } {
  const start = weekAroundToday(offset);
  const next = addDays(start, 7);
  mockExtensionWeek._set(emptyWeek(next));
  return { start, next };
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

// `dates` is every row the deck holds, in VISUAL order — one week normally, and
// this week followed by next week once the planner extends (#639, Phase 6). The
// column's height follows from the count, so the appended week genuinely gives the
// deck further to travel, which is the whole reason today's row can reach the top
// on a Wednesday.
function installDeckLayout(dates: string[]): void {
  const contentH = dates.length * ROW_H + (dates.length - 1) * ROW_GAP;
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
      return isColumn(this) ? contentH : 0;
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

/**
 * Render with a believable layout already in place, so the mount-time anchor
 * measures. Pass `extensionStart` when the run of days is expected to continue
 * into next week, so the fake column is as tall as the real one would be.
 */
function renderLaidOut(startDate: string, extensionStart?: string): void {
  installDeckLayout([
    ...weekDates(startDate),
    ...(extensionStart ? weekDates(extensionStart) : []),
  ]);
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
  mockFirstDay._set('mon');
  mockExtensionWeek._set(null);
  mockExtensionStart._set('');
  mockRecipes._set([RECIPE]);
  mockCanonItems._set([]);
  mockDefaultListId._set('list-1');
  mockShopDay._set(null);
  mockExtensionShopDay._set(null);
  // clearAllMocks keeps implementations, so a per-test override would leak into
  // the next test; the picker's default answer is re-stated here.
  vi.mocked(weekHasEdits).mockResolvedValue({ kind: 'ok', value: false });
  vi.mocked(loadTemplateIntoWeek).mockResolvedValue({ kind: 'ok', value: undefined });
});

// Attach a recipe through the day's real recipe-picker Combobox: click the input
// to open the listbox, then click the option by its title. `title` accepts a
// RegExp because a "When you CBA" option carries its kind badge INSIDE the
// option, so its accessible name is the title plus the badge — see the #637
// block at the foot of this file.
async function attachRecipe(date: string, title: string | RegExp): Promise<void> {
  await userEvent.click(screen.getByTestId(`day-${date}-recipe-picker`));
  await userEvent.click(await screen.findByRole('option', { name: title }));
}

// Open a day's picker without choosing anything, so the offered options can be
// inspected.
async function openPicker(date: string): Promise<void> {
  await userEvent.click(screen.getByTestId(`day-${date}-recipe-picker`));
  await screen.findAllByRole('option');
}

// A week whose single day already holds the given entries, so its detail renders
// their rows (with the per-row "Add to shop" action) without going through the
// picker (setWeekDayRecipes is a no-op mock and never updates the store).
function weekWith(date: string, recipeIds: string[]): MealPlanWeek {
  return {
    ...emptyWeek(date),
    days: {
      ...emptyWeek(date).days,
      [date]: { note: '', recipeIds, chefs: [], attendees: [], guests: 0 },
    },
  };
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

  // ─── Load template asks which week (#639, Phase 7) ───────────────────────
  // The offered weeks are anchored on the REAL today (the page reads the clock),
  // so the expectations are derived the same way rather than hard-coded — the
  // household's first day is 'mon' in these tests.
  const offered = () => templateWeekStarts(TODAY, 'mon');

  async function openLoadPicker(): Promise<void> {
    await userEvent.click(screen.getByTestId('load-template'));
    await waitFor(() => screen.getByTestId('load-template-picker'));
  }

  it('asks which of three weeks to fill instead of silently taking the displayed one', async () => {
    render(MealPlanWeekPage);
    await openLoadPicker();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    // Each option names its week and shows that week's dates.
    const commencing = screen.getByRole('radio', { name: /Week commencing/ });
    expect(screen.getByRole('radio', { name: /This week/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Next week/ })).toBeInTheDocument();
    expect(commencing.textContent).toMatch(/\d/);
    // Nothing is written until a week is chosen and confirmed.
    expect(vi.mocked(loadTemplateIntoWeek)).not.toHaveBeenCalled();
  });

  it('fills the week you chose, not the week on screen', async () => {
    const [, , commencingStart] = offered();
    render(MealPlanWeekPage);
    await openLoadPicker();
    await userEvent.click(screen.getByRole('radio', { name: /Week commencing/ }));
    await userEvent.click(screen.getByTestId('load-template-confirm-btn'));
    await waitFor(() =>
      expect(vi.mocked(loadTemplateIntoWeek)).toHaveBeenCalledWith(commencingStart),
    );
    // …and takes you to it, so the week that changed is the week you can see.
    expect(vi.mocked(goToWeek)).toHaveBeenCalledWith(commencingStart);
  });

  it('warns inline against exactly the offered weeks that already hold edits', async () => {
    const [thisStart, nextStart] = offered();
    vi.mocked(weekHasEdits).mockImplementation((date: string) =>
      Promise.resolve({ kind: 'ok', value: date === nextStart }),
    );
    render(MealPlanWeekPage);
    await openLoadPicker();
    const warning = await screen.findByTestId(`load-template-warning-${nextStart}`);
    // The caution is part of that option's own label, not a separate dialog.
    expect(screen.getByRole('radio', { name: /Next week/ })).toContainElement(warning);
    expect(screen.queryByTestId(`load-template-warning-${thisStart}`)).not.toBeInTheDocument();
  });

  it('says a week could not be checked rather than implying it is empty', async () => {
    const [thisStart] = offered();
    vi.mocked(weekHasEdits).mockResolvedValue({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'corruption' },
    });
    render(MealPlanWeekPage);
    await openLoadPicker();
    await screen.findByTestId(`load-template-unknown-${thisStart}`);
    expect(screen.queryByTestId(`load-template-warning-${thisStart}`)).not.toBeInTheDocument();
  });

  it('toasts when the load itself fails', async () => {
    vi.mocked(loadTemplateIntoWeek).mockResolvedValue({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'unavailable' },
    });
    render(MealPlanWeekPage);
    await openLoadPicker();
    await userEvent.click(screen.getByTestId('load-template-confirm-btn'));
    await waitFor(() =>
      expect(vi.mocked(addToast)).toHaveBeenCalledWith(
        'Failed to load the template.',
        'destructive',
      ),
    );
    expect(vi.mocked(goToWeek)).not.toHaveBeenCalled();
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
    mockWeek._set(weekWith('2026-06-08', ['r1']));
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
    mockWeek._set(weekWith('2026-06-08', ['r1']));
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

  // The rail is a continuous EDGE, not merely a column of dates (#639): the week
  // draws one line down its whole run of days. Next week recolours this same
  // element, so with only next week's stem drawn the current week looked as though
  // it had no rail at all.
  it('draws a continuous rail stem down the displayed week', () => {
    render(MealPlanWeekPage);
    const stem = screen.getByTestId('this-week-rail');
    // Spans the run of days, and is the quiet border ink — next week's job is to
    // differ from this, not the other way round.
    expect(stem.className).toContain('inset-y-0');
    expect(stem.className).toContain('border-border');
    // Decorative: the dates beside it already say what it says.
    expect(stem).toHaveAttribute('aria-hidden', 'true');
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

// ─── Next week appears from Wednesday (#639, Phase 6) ──────────────────────
// The trigger is the last two days of the CYCLE, so these tests place today at
// index 5 or 6 of the displayed week rather than naming a weekday — `firstDayOfWeek`
// is a configurable setting, and Wednesday is only its consequence in production.
describe('MealPlanWeekPage — next week appears from Wednesday (#639, Phase 6)', () => {
  it('appends the whole of next week under a dated mark on the penultimate day', async () => {
    const { start, next } = weekAroundTodayWithNext(5);
    renderLaidOut(start, next);

    // The page asked the service for exactly next week — not for "some week".
    await waitFor(() => expect(vi.mocked(mockSetExtensionWeek)).toHaveBeenCalledWith(next));

    // All fourteen days are in one deck: this week's seven and next week's seven.
    for (const date of [...weekDates(start), ...weekDates(next)]) {
      expect(screen.getByTestId(`day-${date}`)).toBeInTheDocument();
    }
    // …and next week names its own dates, so "next week" is a fact not a direction.
    const mark = screen.getByTestId('next-week-mark');
    expect(mark).toHaveTextContent('Next week');
    expect(mark.textContent).toContain(
      new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${next}T00:00:00.000Z`)),
    );
  });

  it('appends it on the last day of the cycle too', async () => {
    const { start, next } = weekAroundTodayWithNext(6);
    renderLaidOut(start, next);
    await waitFor(() => expect(screen.getByTestId('next-week-mark')).toBeInTheDocument());
    expect(screen.getByTestId(`day-${weekDates(next)[6]}`)).toBeInTheDocument();
  });

  it('shows this week alone before the last two days of the cycle', async () => {
    const { start, next } = weekAroundTodayWithNext(4);
    renderLaidOut(start);

    await waitFor(() => expect(vi.mocked(mockSetExtensionWeek)).toHaveBeenCalledWith(null));
    expect(screen.queryByTestId('next-week-mark')).not.toBeInTheDocument();
    expect(screen.queryByTestId(`day-${weekDates(next)[0]}`)).not.toBeInTheDocument();
  });

  it('never extends a week that is not the one today falls in', async () => {
    // A far-away week, viewed on any day: the extension belongs to today's week.
    const start = addDays(TODAY, -30);
    mockStart._set(start);
    mockWeek._set(emptyWeek(start));
    mockFirstDay._set(weekdayOf(TODAY));
    mockExtensionWeek._set(emptyWeek(addDays(start, 7)));
    renderLaidOut(start);

    await waitFor(() => expect(vi.mocked(mockSetExtensionWeek)).toHaveBeenCalledWith(null));
    expect(screen.queryByTestId('next-week-mark')).not.toBeInTheDocument();
    // …and it lands at the top of that week, not mid-list.
    expect(deckOffset()).toBe(0);
  });

  it('keeps the header range on the primary week — prev/next still mean one week', async () => {
    const { start, next } = weekAroundTodayWithNext(5);
    renderLaidOut(start, next);
    await waitFor(() => expect(screen.getByTestId('next-week-mark')).toBeInTheDocument());

    const primaryEnd = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${weekDates(start)[6]}T00:00:00.000Z`));
    expect(screen.getByTestId('week-range').textContent).toContain(primaryEnd);
    // The label stops at this week: next week's last day is not in it.
    const nextEnd = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${weekDates(next)[6]}T00:00:00.000Z`));
    expect(screen.getByTestId('week-range').textContent).not.toContain(nextEnd);
  });

  it("shows both weeks' shop rules in the same scroll", async () => {
    const { start, next } = weekAroundTodayWithNext(5);
    const thisShop = weekDates(start)[6]!;
    const nextShop = weekDates(next)[1]!;
    mockShopDay._set({ date: thisShop, slot: 'pm' });
    mockExtensionShopDay._set({ date: nextShop, slot: 'am' });
    renderLaidOut(start, next);

    await waitFor(() => expect(screen.getByTestId('next-week-mark')).toBeInTheDocument());
    expect(screen.getByTestId(`day-${thisShop}-shop-marker`)).toHaveTextContent('pm');
    expect(screen.getByTestId(`day-${nextShop}-shop-marker`)).toHaveTextContent('am');
  });

  it("marks next week's rows for the terracotta rail, and leaves this week's alone", async () => {
    const { start, next } = weekAroundTodayWithNext(5);
    renderLaidOut(start, next);
    await waitFor(() => expect(screen.getByTestId('next-week-mark')).toBeInTheDocument());

    const railOf = (date: string): string =>
      screen.getByTestId(`day-${date}`).parentElement?.className ?? '';
    for (const date of weekDates(next)) expect(railOf(date)).toContain('planner-next-week-row');
    for (const date of weekDates(start)) {
      expect(railOf(date)).not.toContain('planner-next-week-row');
    }
    // The colour is week-scoped on the block, not a prop on MealDayEditor.
    expect(screen.getByTestId('next-week-block').getAttribute('style')).toContain(
      '--planner-rail-ink',
    );
  });

  it('leaves today its filled teal disc even with next week on screen', async () => {
    const { start, next } = weekAroundTodayWithNext(5);
    renderLaidOut(start, next);
    await waitFor(() => expect(screen.getByTestId('next-week-mark')).toBeInTheDocument());

    // Today outranks which week it is in: the disc is untouched, and today's row
    // never carries the next-week rail class.
    expect(screen.getByTestId(`day-${TODAY}-date`).className).toContain('bg-primary');
    expect(screen.getByTestId(`day-${TODAY}`).parentElement?.className ?? '').not.toContain(
      'planner-next-week-row',
    );
  });

  it('puts today at the top with next week below it — the appended days are what let it', async () => {
    const { start, next } = weekAroundTodayWithNext(5);
    renderLaidOut(start, next);

    // Today is the sixth row. With one week (7 rows over a 700px viewport) the
    // deck could only travel 844px and today would land clamped short of the top;
    // with next week appended it reaches its own pitch exactly.
    await waitFor(() => expect(deckOffset()).toBe(5 * ROW_PITCH));
  });

  it('reaches next week by gesture — one deck, not two lists', async () => {
    const { start, next } = weekAroundTodayWithNext(5);
    renderLaidOut(start, next);
    await waitFor(() => expect(deckOffset()).toBe(5 * ROW_PITCH));

    // Two days on from today is the first day of NEXT week, and the deck stops on
    // it: next week's rows are stops in the same deck, not a separate scroller.
    const deck = screen.getByTestId('week-deck');
    deck.focus();
    // One press, one day — and the spring must land before the next press, or the
    // second stop is measured from mid-flight.
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(deckOffset()).toBe(6 * ROW_PITCH));
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(deckOffset()).toBe(7 * ROW_PITCH));
  });

  it('edits a day in next week under that day’s own date key', async () => {
    const { start, next } = weekAroundTodayWithNext(5);
    renderLaidOut(start, next);
    await waitFor(() => expect(screen.getByTestId('next-week-mark')).toBeInTheDocument());

    const nextDay = weekDates(next)[2]!;
    await expandDay(nextDay);
    await userEvent.type(screen.getByTestId(`day-${nextDay}-note`), 'Roast');

    // The date key IS the routing (Phase 5): no week argument, and never this
    // week's date for a day that belongs to next week.
    await waitFor(() => expect(vi.mocked(setWeekDayNote)).toHaveBeenCalled());
    expect(vi.mocked(setWeekDayNote).mock.calls[0]![0]).toBe(nextDay);
  });

  it('surfaces a refused save instead of swallowing it', async () => {
    // A week the service has not read is one it refuses to overwrite. With two
    // weeks on screen a silent refusal would look exactly like a saved edit.
    vi.mocked(setWeekDayGuests).mockResolvedValueOnce({
      kind: 'err',
      error: { kind: 'ValidationError', code: 'WEEK_NOT_LOADED', message: 'nope' },
    } as never);
    const { start, next } = weekAroundTodayWithNext(5);
    renderLaidOut(start, next);
    await waitFor(() => expect(screen.getByTestId('next-week-mark')).toBeInTheDocument());

    const nextDay = weekDates(next)[2]!;
    await expandDay(nextDay);
    await userEvent.click(screen.getByTestId(`day-${nextDay}-guests-inc`));

    await waitFor(() =>
      expect(vi.mocked(addToast)).toHaveBeenCalledWith('Failed to save the day.', 'destructive'),
    );
  });

  it('drops next week when the planner is left', async () => {
    const { start, next } = weekAroundTodayWithNext(5);
    renderLaidOut(start, next);
    await waitFor(() => expect(vi.mocked(mockSetExtensionWeek)).toHaveBeenCalledWith(next));

    cleanup();
    // The service is a module singleton; leaving must not leave a second week
    // (and a second shop-day range read) subscribed behind us.
    expect(vi.mocked(mockSetExtensionWeek)).toHaveBeenLastCalledWith(null);
  });
});

// ─── "When you CBA" in the planner (#637, Phase 4) ─────────────────────────
// An outing fills a dinner slot like any other entry — same picker, same note
// auto-fill, same hero thumbnail — and offers nothing that does not apply to it.
// A cocktail is not dinner and is never offered at all. Every one of these is a
// consequence of the DOMAIN predicates (`isPlannable`, `takesIngredients`), so
// the assertions are about what the screen offers, not about the kind string.
describe('MealPlanWeekPage — when you CBA (#637, Phase 4)', () => {
  it('offers CBA options alongside recipes, and never a cocktail', async () => {
    mockRecipes._set([RECIPE, OUTING, COCKTAIL]);
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    await openPicker('2026-06-08');

    expect(screen.getByRole('option', { name: 'Spaghetti Bolognese' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Takeaway — Indian/ })).toBeInTheDocument();
    // `isPlannable('cocktail')` is false, so it is not on the menu for a dinner.
    expect(screen.queryByRole('option', { name: /Negroni/ })).not.toBeInTheDocument();
  });

  it('drops an already-attached CBA option from the picker', async () => {
    mockRecipes._set([RECIPE, OUTING]);
    mockWeek._set(weekWith('2026-06-08', ['o1']));
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    await openPicker('2026-06-08');

    // Attached once is enough — the same night out can't be added twice.
    expect(screen.queryByRole('option', { name: /Takeaway — Indian/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Spaghetti Bolognese' })).toBeInTheDocument();
  });

  it('badges a CBA option and leaves a recipe unmarked', async () => {
    mockRecipes._set([RECIPE, OUTING]);
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    await openPicker('2026-06-08');

    const outing = screen.getByRole('option', { name: /Takeaway — Indian/ });
    expect(within(outing).getByText('When you CBA')).toBeInTheDocument();

    // The default kind wears nothing: the picker looks exactly as it does today
    // for anyone who never adds an alternative.
    const recipe = screen.getByRole('option', { name: 'Spaghetti Bolognese' });
    expect(recipe.textContent?.trim()).toBe('Spaghetti Bolognese');
  });

  it('auto-fills an empty meal with a CBA title exactly as with a recipe', async () => {
    mockRecipes._set([RECIPE, OUTING]);
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');
    await attachRecipe('2026-06-08', /Takeaway — Indian/);

    // Attaching is attaching: `addRecipe` deliberately does NOT branch on kind,
    // so the day gets its title just as a recipe night would.
    expect(vi.mocked(setWeekDayRecipes)).toHaveBeenCalledWith('2026-06-08', ['o1']);
    await waitFor(() =>
      expect(vi.mocked(setWeekDayNote)).toHaveBeenCalledWith('2026-06-08', 'Takeaway — Indian'),
    );
  });

  it('offers no "Add to shop" on an attached CBA night, but still does on a recipe', async () => {
    mockRecipes._set([RECIPE, OUTING]);
    mockWeek._set(weekWith('2026-06-08', ['r1', 'o1']));
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');

    // Both rows render — the outing is a first-class night, not a lesser one…
    expect(screen.getByTestId('day-2026-06-08-recipe-row-o1')).toBeInTheDocument();
    expect(screen.getByTestId('day-2026-06-08-recipe-row-r1')).toBeInTheDocument();
    // …but a takeaway has nothing to buy, so the action simply isn't there.
    expect(screen.queryByTestId('day-2026-06-08-recipe-addshop-o1')).not.toBeInTheDocument();
    expect(screen.getByTestId('day-2026-06-08-recipe-addshop-r1')).toBeInTheDocument();
    // Removing works on either, so a wrongly-attached outing is not stuck.
    expect(screen.getByTestId('day-2026-06-08-recipe-remove-o1')).toBeInTheDocument();
  });

  it('wears the kind pictogram when a CBA option has no hero image', async () => {
    mockRecipes._set([RECIPE, OUTING]);
    mockWeek._set(weekWith('2026-06-08', ['o1']));
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');

    // No image on the fixture, so the row falls back to the kind's own glyph
    // rather than a cooking pot.
    const fallback = screen.getByTestId('day-2026-06-08-recipe-thumb-fallback-o1');
    expect(fallback.querySelector('.lucide-hand-platter')).not.toBeNull();
  });

  it('shows the hero thumbnail even on a document still carrying legacy imageHidden', async () => {
    // `imageHidden` is retired and no longer read anywhere in web-pwa; a stale
    // `true` must not blank the planner thumbnail while the same photo shows on
    // the recipe list and view pages.
    mockRecipes._set([
      {
        ...OUTING,
        image: { url: 'https://example.test/curry.webp' },
        imageHidden: true,
        updatedAt: '2026-06-01T00:00:00.000Z',
      } as unknown as Recipe,
    ]);
    mockWeek._set(weekWith('2026-06-08', ['o1']));
    render(MealPlanWeekPage);
    await expandDay('2026-06-08');

    const thumb = screen.getByTestId('day-2026-06-08-recipe-thumb-o1');
    expect(thumb.getAttribute('src')).toContain('https://example.test/curry.webp');
    expect(screen.queryByTestId('day-2026-06-08-recipe-thumb-fallback-o1')).not.toBeInTheDocument();
  });
});
