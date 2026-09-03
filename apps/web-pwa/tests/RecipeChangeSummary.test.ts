import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/svelte';
import type { RecipeDiff, RecipePhase } from '@salt/domain';

// The phase gate (issue #1212). The real module reads uninitialised observability
// and therefore always answers "on", so both halves of the swap — three time
// cards off, one Timing card on — need it driven from here.
const { mockPhasesGate } = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockPhasesGate: makeStore<{ enabled: boolean; settled: boolean }>({
      enabled: false,
      settled: true,
    }),
  };
});

vi.mock('../src/lib/featureGate.js', () => ({
  recipePhasesGate: mockPhasesGate,
  breadGate: {
    subscribe: (fn: (v: unknown) => void) => (fn({ enabled: true, settled: true }), () => {}),
  },
  featureGate: () => mockPhasesGate,
  isFeatureEnabled: () => true,
}));

import RecipeChangeSummary from '../src/routes/recipes/RecipeChangeSummary.svelte';

// The review gate reads as a diff, not a wall of text (issue #825). What is
// pinned here is the ONE rule the design rests on: how a change is drawn follows
// from the change itself, never from which field it came out of. The same
// component that puts `750 g → 1.1 kg` on a single line must mark the words in a
// reworded step and must refuse to mark anything in a rewritten one.

afterEach(() => {
  cleanup();
  mockPhasesGate._set({ enabled: false, settled: true });
});

const EMPTY: RecipeDiff = {
  hasChanges: true,
  ingredients: { added: [], removed: [], changed: [] },
  steps: { added: [], removed: [], changed: [] },
  metadata: {},
  tags: { added: [], removed: [] },
};

function open(diff: Partial<RecipeDiff>): void {
  render(RecipeChangeSummary, {
    props: {
      diff: { ...EMPTY, ...diff },
      open: true,
      applying: false,
      onApply: vi.fn(),
      onDiscard: vi.fn(),
    },
  });
}

/** The single card in the sheet, whichever group it landed in. */
function onlyCard(): HTMLElement {
  const cards = screen.getAllByRole('listitem');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

// Both sides comfortably over the 42-character short-value cut-off, so the
// rendering is decided by how much of the sentence survived and nothing else.
const ORIGINAL_STEP = 'Give the potatoes a scrub and cut any larger ones in half';
const ADJUSTED_STEP = 'Give the potatoes a scrub and halve any larger ones';
const UNRELATED_STEP = 'Bring a large pan of salted water to a rolling boil first';

describe('RecipeChangeSummary — how a change is drawn follows from the change', () => {
  it('keeps a short value on one line, with no word marks to read', () => {
    // The compactness test. A quantity edit is no more verbose than the flat
    // list this replaced — one line, both values, an arrow.
    open({ metadata: { servings: { from: 4, to: 6 } } });

    const card = onlyCard();
    expect(card.textContent).toContain('4');
    expect(within(card).getByTestId('recipe-change-proposed')).toHaveTextContent('6');
    expect(card.querySelector('del')).toBeNull();
    expect(card.querySelector('ins')).toBeNull();
    expect(within(card).queryByTestId('recipe-change-inline')).toBeNull();
  });

  it('renders an unset numeric field as a one-line value, not as an absence', () => {
    // "none → 15 min" is a value change, not a creation: a number that is unset
    // still has a readable one-line rendering, so it stays an ordinary edit.
    open({ metadata: { prepTimeMinutes: { from: null, to: 15 } } });

    const card = onlyCard();
    expect(card.textContent).toContain('none');
    expect(within(card).getByTestId('recipe-change-proposed')).toHaveTextContent('15 min');
  });

  it('marks only the words that moved in an adjusted sentence', () => {
    open({
      steps: {
        added: [],
        removed: [],
        changed: [{ id: 's1', position: 2, text: { from: ORIGINAL_STEP, to: ADJUSTED_STEP } }],
      },
    });

    const card = onlyCard();
    expect(within(card).getByTestId('recipe-change-inline')).toBeInTheDocument();
    // The handful that actually moved — and nothing else.
    expect([...card.querySelectorAll('del')].map((n) => n.textContent?.trim())).toEqual([
      'cut',
      'in half',
    ]);
    expect([...card.querySelectorAll('ins')].map((n) => n.textContent?.trim())).toEqual(['halve']);
    // The words that survived are still there, unmarked.
    expect(card.textContent).toContain('Give the potatoes a scrub');
  });

  it('stops pretending a rewritten passage is an edit', () => {
    // THE case the rule exists for: interleaving marks through a wholesale
    // rewrite produces dozens of alternating fragments that read slower than
    // either version alone. Old above new, said plainly.
    open({
      steps: {
        added: [],
        removed: [],
        changed: [{ id: 's1', position: 2, text: { from: ORIGINAL_STEP, to: UNRELATED_STEP } }],
      },
    });

    const card = onlyCard();
    expect(within(card).queryByTestId('recipe-change-inline')).toBeNull();
    expect(card.querySelector('del')).toBeNull();
    expect(card.querySelector('ins')).toBeNull();
    expect(card.textContent).toContain(ORIGINAL_STEP);
    expect(within(card).getByTestId('recipe-change-proposed')).toHaveTextContent(UNRELATED_STEP);
    expect(card.textContent?.toLowerCase()).toContain('rewritten');
  });

  it('chips a step of the same length by content, not by length alone', () => {
    // Two changes of near-identical size, one adjusted and one rewritten: the
    // only thing separating them is how much survived, which is the whole claim.
    open({
      steps: {
        added: [],
        removed: [],
        changed: [
          { id: 's1', position: 1, text: { from: ORIGINAL_STEP, to: ADJUSTED_STEP } },
          { id: 's2', position: 2, text: { from: ORIGINAL_STEP, to: UNRELATED_STEP } },
        ],
      },
    });

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent?.toLowerCase()).toContain('edit');
    expect(cards[1]!.textContent?.toLowerCase()).toContain('rewritten');
  });
});

describe('RecipeChangeSummary — a card says what kind of change it is', () => {
  it('chips an added ingredient "new" and shows only the proposed side', () => {
    open({
      ingredients: { added: [{ id: 'i1', rawText: '2 tbsp capers' }], removed: [], changed: [] },
    });

    const card = onlyCard();
    expect(card.textContent?.toLowerCase()).toContain('new');
    expect(within(card).getByTestId('recipe-change-proposed')).toHaveTextContent('2 tbsp capers');
  });

  it('chips a removed ingredient "gone" and offers no proposed side at all', () => {
    open({
      ingredients: { added: [], removed: [{ id: 'i1', rawText: '2 tbsp capers' }], changed: [] },
    });

    const card = onlyCard();
    expect(card.textContent?.toLowerCase()).toContain('gone');
    expect(card.textContent).toContain('2 tbsp capers');
    // Nothing is being proposed in its place — an empty proposed element would
    // be a lie about what Apply is going to write.
    expect(within(card).queryByTestId('recipe-change-proposed')).toBeNull();
  });

  it('chips a reworded ingredient "edit" and shows both sides of it', () => {
    // The third ingredient shape, and the only one with two sides: the same item
    // reworded keeps its place in the list rather than reading as a delete plus
    // an add, which is what the flat list it replaced made of it.
    open({
      ingredients: {
        added: [],
        removed: [],
        changed: [{ id: 'i1', from: '2 tbsp capers', to: '1 tbsp capers, rinsed' }],
      },
    });

    const card = onlyCard();
    expect(card.textContent?.toLowerCase()).toContain('edit');
    expect(card.textContent).toContain('2 tbsp capers');
    expect(within(card).getByTestId('recipe-change-proposed')).toHaveTextContent(
      '1 tbsp capers, rinsed',
    );
  });

  it('labels a step card with the step it applies to', () => {
    open({
      steps: {
        added: [{ id: 's1', position: 3, text: 'Rest for ten minutes' }],
        removed: [],
        changed: [],
      },
    });

    expect(onlyCard().textContent).toContain('Step 3');
  });

  it('chips a deleted step "gone", names it, and proposes nothing in its place', () => {
    // A step the chef wants to DROP is the one change Apply makes that leaves
    // less than it found, so it has to be as readable as an addition: the label
    // says which step goes, and there is no proposed side to mistake for a
    // replacement.
    open({
      steps: {
        added: [],
        removed: [{ id: 's1', position: 2, text: 'Rest for ten minutes' }],
        changed: [],
      },
    });

    const card = onlyCard();
    expect(card.textContent).toContain('Step 2');
    expect(card.textContent?.toLowerCase()).toContain('gone');
    expect(card.textContent).toContain('Rest for ten minutes');
    expect(within(card).queryByTestId('recipe-change-proposed')).toBeNull();
  });

  it('splits one step into a card per facet it changed', () => {
    // text / timer / note are independent facets on the same StepChange, and each
    // is a separate thing to read and agree to.
    open({
      steps: {
        added: [],
        removed: [],
        changed: [
          {
            id: 's1',
            position: 1,
            text: { from: 'Simmer gently', to: 'Simmer hard' },
            timer: { from: null, to: { durationMinutes: 15, description: null } },
            note: { from: null, to: 'Watch it does not catch' },
          },
        ],
      },
    });

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(cards[1]!.textContent).toContain('no timer');
    expect(cards[2]!.textContent?.toLowerCase()).toContain('new');
  });
});

describe('RecipeChangeSummary — two columns from the fold up', () => {
  // The seam is the `split:` Tailwind variant and nothing else — no matchMedia,
  // no width in script — so what these pin is the CLASS CONTRACT: the element is
  // in the DOM at every width and CSS alone decides whether it is seen. jsdom
  // loads no stylesheet, so asserting the variant is the honest way to say "this
  // is gated on the app's one layout breakpoint and not on a re-derived one".
  // Whether 700px is the right number is settled in `app.css`; that it is the
  // number used here is what would silently rot.

  it('shows the column headings only above the seam, pinned to the top of the list', () => {
    open({ title: { from: 'Pilaf', to: 'Chorizo Pilaf' } });

    const row = screen.getByText('Now').parentElement!;
    expect(row).toContainElement(screen.getByText('Proposed'));
    // Never on a phone: on 390px the headings would eat a line and explain
    // nothing, because there is only one column under them.
    expect(row).toHaveClass('hidden', 'split:grid', 'split:grid-cols-2');
    // Pinned inside the scroller, not stacked above it — the question they
    // answer has to survive scrolling past the first card.
    expect(row).toHaveClass('sticky', 'top-0');
  });

  it('names the empty side of an addition instead of leaving a blank column', () => {
    open({
      ingredients: { added: [{ id: 'i1', rawText: '2 tbsp capers' }], removed: [], changed: [] },
    });

    const card = onlyCard();
    // An empty Now cell reads as missing data; "Not in the recipe yet" reads as
    // an addition. Below the seam it is display:none, so the phone rendering
    // still shows the value alone.
    expect(within(card).getByText('Not in the recipe yet')).toHaveClass('hidden', 'split:block');
  });

  it('names the empty side of a removal, without offering it as a proposed value', () => {
    open({
      ingredients: { added: [], removed: [{ id: 'i1', rawText: '2 tbsp capers' }], changed: [] },
    });

    const card = onlyCard();
    const empty = within(card).getByText('Removed');
    expect(empty).toHaveClass('hidden', 'split:block');
    // It fills the column; it is not a value Apply is going to write, so it must
    // stay out of the id specs read the proposed side by.
    expect(empty).not.toHaveAttribute('data-testid');
    expect(within(card).queryByTestId('recipe-change-proposed')).toBeNull();
  });

  it('turns a two-sided card into the two cells, and drops the arrow with them', () => {
    open({ metadata: { servings: { from: 4, to: 6 } } });

    const card = onlyCard();
    expect(within(card).getByTestId('recipe-change-proposed').parentElement).toHaveClass(
      'split:grid',
      'split:grid-cols-2',
    );
    // `old → new` is how one line reads; two columns under headings say it
    // already, and a stray arrow between them would be read as a third cell.
    expect(within(card).getByText('→')).toHaveClass('split:hidden');
  });

  it('lets an interleaved rendering span both columns rather than tearing it in half', () => {
    // The inline rendering has no two sides by construction — old and new are in
    // one sentence. Splitting it would mean abandoning the highlight, which is
    // the whole reason it exists.
    open({
      steps: {
        added: [],
        removed: [],
        changed: [{ id: 's1', position: 2, text: { from: ORIGINAL_STEP, to: ADJUSTED_STEP } }],
      },
    });

    const inline = within(onlyCard()).getByTestId('recipe-change-inline');
    expect(inline.className).not.toContain('split:grid');
  });
});

describe('RecipeChangeSummary — the sheet contract is unchanged', () => {
  it('renders no section at all for a group with nothing in it', () => {
    // The absence check both e2e specs read as "the chef proposed no change
    // here" — an empty shell would read as a proposal.
    open({ title: { from: 'Pilaf', to: 'Chorizo Pilaf' } });

    expect(screen.getByTestId('recipe-change-group-basics')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-change-group-ingredients')).toBeNull();
    expect(screen.queryByTestId('recipe-change-group-steps')).toBeNull();
    expect(screen.queryByTestId('recipe-change-group-metadata')).toBeNull();
    expect(screen.queryByTestId('recipe-change-group-tags')).toBeNull();
  });

  it('keeps a short title assertable as one contiguous string', () => {
    // Both e2e specs assert toContainText(<amended title>) on the basics group,
    // and Playwright reads concatenated textContent — which word-level marks
    // split apart. A title under the short-value cut-off never reaches them.
    open({ title: { from: 'Review Gate Pilaf', to: 'Stubbed Chilli Pilaf' } });

    expect(screen.getByTestId('recipe-change-group-basics').textContent).toContain(
      'Stubbed Chilli Pilaf',
    );
  });

  it('offers nothing to apply when there is nothing to change', () => {
    render(RecipeChangeSummary, {
      props: {
        diff: { ...EMPTY, hasChanges: false },
        open: true,
        applying: false,
        onApply: vi.fn(),
        onDiscard: vi.fn(),
      },
    });

    expect(screen.getByTestId('recipe-change-summary-none')).toHaveTextContent('No changes.');
    expect(screen.queryByTestId('recipe-change-apply')).toBeNull();
    expect(screen.getByTestId('recipe-change-discard')).toBeInTheDocument();
  });

  it('still offers exactly two choices, and no per-row selection', () => {
    open({ tags: { added: ['midweek'], removed: ['sunday'] } });

    expect(screen.getByTestId('recipe-change-apply')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-change-discard')).toBeInTheDocument();
    // A proposal is one thing you accept or refuse (issue #824 holds the
    // deferred per-row capability) — nothing in the list is selectable.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

// ── The Timing card (issue #1212) ───────────────────────────────────────────
//
// The gate's whole point: a chat proposal that rewrites the phase strip, or that
// quietly deletes the sentence over it, must be on screen BEFORE it is written.
// Until `diffRecipe` reported the pair, neither was.
describe('RecipeChangeSummary — the phase strip, key on', () => {
  const MIX: RecipePhase = { label: 'Mix & knead', handsOnMinutes: 20, handsOffMinutes: 0 };
  const PROVE: RecipePhase = { label: 'First rise', handsOnMinutes: 0, handsOffMinutes: 90 };

  function openWithPhases(metadata: RecipeDiff['metadata']): void {
    mockPhasesGate._set({ enabled: true, settled: true });
    open({ metadata });
  }

  it('draws ONE card for a whole rewritten strip, not one per phase', () => {
    openWithPhases({ phases: { from: [MIX], to: [MIX, PROVE] } });

    const card = onlyCard();
    expect(card.textContent).toContain('Timing');
    expect(card.textContent).toContain('Mix & knead 20 min');
    expect(within(card).getByTestId('recipe-change-proposed')).toHaveTextContent('First rise');
  });

  it('shows a deleted sentence as a change rather than letting it land unseen', () => {
    openWithPhases({
      timingSummary: { from: 'About 25 minutes of you, over 2 hours.', to: null },
    });

    const card = onlyCard();
    expect(card.textContent).toContain('About 25 minutes of you');
    expect(within(card).getByTestId('recipe-change-proposed')).toHaveTextContent('no summary');
  });

  // The strip is not in the diff when it did not change, so the card must not
  // claim anything about it — "none" there would read as "this recipe has no
  // phases" at the moment the reviewer is deciding.
  it('says nothing about the strip when only the sentence moved', () => {
    openWithPhases({ timingSummary: { from: null, to: 'Mostly hands-off.' } });

    const card = onlyCard();
    expect(within(card).getByTestId('recipe-change-proposed')).toHaveTextContent(
      'Mostly hands-off.',
    );
    // No strip half at all: no phase list, and not the em-dash that joins the two
    // halves when both are in the diff.
    expect(card.textContent).not.toContain('none');
    expect(card.textContent).not.toContain(' — ');
  });

  it('replaces the three time cards — no Prep or Cook number anywhere', () => {
    openWithPhases({
      phases: { from: [MIX], to: [PROVE] },
      prepTimeMinutes: { from: 10, to: 20 },
      cookTimeMinutes: { from: 30, to: 40 },
      totalTimeMinutes: { from: 40, to: 60 },
    });

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(1);
    expect(screen.queryByText('Prep time')).toBeNull();
    expect(screen.queryByText('Cook time')).toBeNull();
    expect(screen.queryByText('Total time')).toBeNull();
  });

  it('keeps Servings its own card', () => {
    openWithPhases({
      servings: { from: 4, to: 6 },
      phases: { from: [MIX], to: [PROVE] },
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('RecipeChangeSummary — the phase strip, key off', () => {
  it('reads exactly as it does today: three time cards, no Timing card', () => {
    open({
      metadata: {
        phases: { from: [], to: [{ label: 'Bake', handsOnMinutes: 5, handsOffMinutes: 40 }] },
        timingSummary: { from: null, to: 'Mostly hands-off.' },
        prepTimeMinutes: { from: 10, to: 20 },
      },
    });

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toContain('Prep time');
    expect(screen.queryByText('Timing')).toBeNull();
  });
});
