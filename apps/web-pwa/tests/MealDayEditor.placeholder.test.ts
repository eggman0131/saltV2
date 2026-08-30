import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { emptyRecipe } from '@salt/domain';
import type { Day, Member, Recipe } from '@salt/domain';
import type { WeatherDaySummary } from '@salt/domain/schemas';

import MealDayEditor from '../src/routes/mealplan/MealDayEditor.svelte';

// The note-only night gets a photograph (#652, Phase 2).
//
// Type a meal into a day with no recipe, tap out of the field, and a placeholder
// is attached to that day — so it carries a card in the week like every other
// planned night. These tests are pointed at the GUARDS around that attach, not
// at which picture comes back: `pickPlaceholder` owns the choice and is unit
// tested in the domain. What is this component's to get right is *when* it fires
// (blur, once, on a written note with nothing attached), that it hands over the
// day's own date and forecast, and that it stays entirely out of the recipe-free
// template editor.

const alex: Member = { id: 'm1', name: 'Alex' } as Member;
const noop = () => {};
const NOW = '2026-01-01T00:00:00.000Z';

// January → the season's mood is `comfort`; July → `bright`. Both well clear of
// the boundary, so neither test is one month from meaning something else.
const WINTER_DAY = '2026-01-15';
const SUMMER_DAY = '2026-07-15';

function placeholder(
  id: string,
  mood: string,
  image: Recipe['image'] = { url: `${id}.jpg`, source: 'ai' },
) {
  const base = emptyRecipe(id, NOW, 'placeholder');
  return {
    ...base,
    title: `Placeholder — ${mood}`,
    image,
    metadata: { ...base.metadata, tags: [mood] },
    updatedAt: NOW,
  };
}

const comfortOne = placeholder('ph-comfort', 'comfort');
const brightOne = placeholder('ph-bright', 'bright');
const roast: Recipe = { ...emptyRecipe('r1', NOW), title: 'Sunday Roast', updatedAt: NOW };

function makeDay(overrides: Partial<Day> = {}): Day {
  return { note: '', recipeIds: [], chefs: [], attendees: [], guests: 0, ...overrides };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Thu',
    sublabel: '15',
    sheetTitle: 'Thursday 15 January',
    day: makeDay({ note: 'Roast chicken dinner' }),
    members: [alex],
    recipes: [comfortOne, brightOne],
    testid: 'day',
    dateKey: WINTER_DAY,
    onNoteChange: noop,
    onChefToggle: noop,
    onAttendeeToggle: noop,
    onAttendeeHomeTime: noop,
    onAttendeeNote: noop,
    onGuestsChange: noop,
    onRecipesChange: noop,
    ...overrides,
  };
}

/** Open the day's sheet and leave the dinner field, which is the whole gesture. */
async function blurDinnerField(): Promise<void> {
  await userEvent.click(screen.getByTestId('day-summary'));
  await fireEvent.blur(screen.getByTestId('day-note'));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('MealDayEditor — the placeholder attach (#652)', () => {
  it('attaches a placeholder when the day is left with a meal and no recipe', async () => {
    const onRecipesChange = vi.fn();
    render(MealDayEditor, { props: baseProps({ onRecipesChange }) });
    await blurDinnerField();

    // January, so the season's own mood stands: the comfort set, not the bright
    // one. Which picture is the domain's business; that it came from the right
    // set is what proves the date reached it.
    expect(onRecipesChange).toHaveBeenCalledWith(['ph-comfort']);
  });

  it('hands the evening forecast over, so a cold summer night gets a comfort picture', async () => {
    // July — the season says `bright` — but a genuinely cold evening. The domain
    // lets a decisive forecast override the season, and it can only do that if
    // this component actually passes `weather` through.
    const coldJuly: WeatherDaySummary = {
      tempHigh: 12,
      tempLow: 7,
      apparentTemp: 8,
      humidity: 85,
      cloudCover: 90,
      precipitationChance: 70,
      weatherCode: 61,
      isDay: true,
    };
    const onRecipesChange = vi.fn();
    render(MealDayEditor, {
      props: baseProps({ onRecipesChange, dateKey: SUMMER_DAY, weather: coldJuly }),
    });
    await blurDinnerField();

    expect(onRecipesChange).toHaveBeenCalledWith(['ph-comfort']);
  });

  it('leaves a summer night to the bright set', async () => {
    const onRecipesChange = vi.fn();
    render(MealDayEditor, { props: baseProps({ onRecipesChange, dateKey: SUMMER_DAY }) });
    await blurDinnerField();

    expect(onRecipesChange).toHaveBeenCalledWith(['ph-bright']);
  });

  it('attaches nothing to a day that already has a recipe', async () => {
    const onRecipesChange = vi.fn();
    render(MealDayEditor, {
      props: baseProps({
        onRecipesChange,
        day: makeDay({ note: 'Sunday Roast', recipeIds: ['r1'] }),
        recipes: [comfortOne, brightOne, roast],
      }),
    });
    await blurDinnerField();

    expect(onRecipesChange).not.toHaveBeenCalled();
  });

  it('attaches nothing on a day left with no meal written', async () => {
    const onRecipesChange = vi.fn();
    render(MealDayEditor, { props: baseProps({ onRecipesChange, day: makeDay({ note: '   ' }) }) });
    await blurDinnerField();

    expect(onRecipesChange).not.toHaveBeenCalled();
  });

  it('attaches nothing before the library exists', async () => {
    const onRecipesChange = vi.fn();
    render(MealDayEditor, { props: baseProps({ onRecipesChange, recipes: [roast] }) });
    await blurDinnerField();

    // The whole of this feature's behaviour until placeholders have been built:
    // nothing happens and the day stays a block of text.
    expect(onRecipesChange).not.toHaveBeenCalled();
  });

  it('never attaches a placeholder whose hero generation failed', async () => {
    const onRecipesChange = vi.fn();
    render(MealDayEditor, {
      props: baseProps({ onRecipesChange, recipes: [placeholder('ph-blank', 'comfort', null)] }),
    });
    await blurDinnerField();

    // A card with no photograph is worse than the line of text it replaced.
    expect(onRecipesChange).not.toHaveBeenCalled();
  });

  it('attaches nothing to an undated row, which is what the template editor is', async () => {
    // The weekday-keyed template editor is recipe-free by design — it is used for
    // who is likely to be eating and cooking, never for meals — and it has no
    // dates at all. Its missing `dateKey` is the gate, asserted here with the
    // handler still supplied so it is the DATE being tested and not the handler.
    const onRecipesChange = vi.fn();
    render(MealDayEditor, {
      props: baseProps({ onRecipesChange, dateKey: undefined, sublabel: undefined }),
    });
    await blurDinnerField();

    expect(onRecipesChange).not.toHaveBeenCalled();
  });

  it('renders no recipe list at all in the template editor', async () => {
    render(MealDayEditor, {
      props: baseProps({ onRecipesChange: undefined, dateKey: undefined, sublabel: undefined }),
    });
    await blurDinnerField();

    expect(screen.queryByTestId('day-recipes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('day-recipe-picker')).not.toBeInTheDocument();
  });

  it('still re-seeds an emptied meal field from the attached recipe', async () => {
    // The two blur behaviours are mutually exclusive — one needs the field
    // written, the other needs it empty — so wiring the attach must not have
    // disturbed the re-seed that was already there (#469).
    const onNoteChange = vi.fn();
    const onRecipesChange = vi.fn();
    render(MealDayEditor, {
      props: baseProps({
        onNoteChange,
        onRecipesChange,
        day: makeDay({ note: '', recipeIds: ['r1'] }),
        recipes: [comfortOne, roast],
      }),
    });
    await blurDinnerField();

    expect(onNoteChange).toHaveBeenCalledWith('Sunday Roast');
    expect(onRecipesChange).not.toHaveBeenCalled();
  });

  it('says a day with neither a note nor a recipe is unplanned', () => {
    render(MealDayEditor, { props: baseProps({ day: makeDay() }) });

    // "Nothing planned", not "No meal set": now that every planned night carries
    // a photograph, this row is the only kind without one and should read as the
    // hole in the week that it is.
    expect(screen.getByTestId('day-meal')).toHaveTextContent('Nothing planned');
  });
});

// ─── Resolving attached recipe ids, in the sheet (issue #1055) ─────────────────
// The counterpart to `MealDayEditor.summary.test.ts`'s table. The collapsed row
// resolves ids to pick ONE photograph; the sheet resolves the same ids to a LIST,
// so this is where the order and the skip are visible as rendered rows rather
// than inferred from which picture won.
//
// `MealDayDetail` renders a KEYED each over the resolved recipes, so a duplicated
// id is not a question that can be put to this surface — duplicates are pinned
// against the pure derivation in `personalViewService.test.ts` instead.
describe('MealDayEditor — the sheet resolves the ids a day holds', () => {
  const pie: Recipe = { ...emptyRecipe('r2', NOW), title: 'Steak Pie', updatedAt: NOW };

  /** Open the day's sheet without blurring the note, so nothing is attached. */
  async function openSheet(): Promise<void> {
    await userEvent.click(screen.getByTestId('day-summary'));
  }

  async function rowTitles(recipeIds: string[]): Promise<string[]> {
    render(MealDayEditor, {
      props: baseProps({
        day: makeDay({ note: 'Dinner', recipeIds }),
        recipes: [roast, pie],
      }),
    });
    await openSheet();
    return [
      ...screen.getByTestId('day-recipes').querySelectorAll('[data-testid^="day-recipe-row-"]'),
    ].map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  }

  it('lists them in the order the DAY holds, not the order the store does', async () => {
    const titles = await rowTitles(['r2', 'r1']);
    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain('Steak Pie');
    expect(titles[1]).toContain('Sunday Roast');
  });

  it('skips a recipe deleted since it was attached rather than rendering a blank row', async () => {
    const titles = await rowTitles(['ghost', 'r1']);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('Sunday Roast');
  });

  it('renders no list at all when not one id resolves', async () => {
    render(MealDayEditor, {
      props: baseProps({
        day: makeDay({ note: 'Dinner', recipeIds: ['ghost', 'also-ghost'] }),
        recipes: [roast, pie],
      }),
    });
    await openSheet();

    expect(screen.queryByTestId('day-recipe-row-ghost')).not.toBeInTheDocument();
    expect(screen.queryByTestId('day-recipe-row-also-ghost')).not.toBeInTheDocument();
  });
});
