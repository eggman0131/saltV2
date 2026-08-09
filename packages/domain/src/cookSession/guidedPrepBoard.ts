import { prepEntryIngredients } from './prepEntryIngredients.js';
import { normaliseContainerName } from './normaliseContainerName.js';
import { unpreppedIngredients } from './unpreppedIngredients.js';
import type { Ingredient, Recipe } from '../recipe/index.js';
import type { GuidedPrepEntryDoc } from '../schemas/index.js';

// THE PREP SCREEN, as a shape (issue #767).
//
// The plan stores prep as a flat list of jobs, each ending with something set
// aside in a named container. That is the order the jobs are DONE in, but it is
// not the order the bench is SET in: the cook fetches one bowl and then fills it,
// which may take two or three jobs. So the container leads, and the jobs it
// collects hang under it — get this bowl → do these things → these amounts go in.
//
// The other half of the same correction is what a TICK means. A job is a sentence
// naming several ingredients ("dice the carrots, onion and celery") and the cook
// does them one at a time, so a single tick that clears the whole sentence is a
// tick you can only give at the end, from memory. Here the INGREDIENTS are the
// tick rows: ticking the last one is what finishes the job, and finishing every
// job is what finishes the card. Nothing new is stored — every row's id is already
// what `checkedPrepIds` holds.
//
// PURE STRUCTURE, no session: the board depends only on the recipe and the plan,
// so it survives every tick without being rebuilt, and progress is asked of it
// separately (`guidedMiseProgress`, `guidedPrepCardProgress`).

// One thing the cook can tick.
export interface GuidedPrepTickRow {
  // What goes in `checkedPrepIds`. The INGREDIENT's id where there is one — which
  // is also what the "Also get out" remainder ticks by, so the two kinds of row on
  // the screen agree — and the JOB's id for a job that names no ingredient at all
  // ("open the tin"), which would otherwise have nothing to tick.
  readonly id: string;
  // Null on a job-level row: there is no ingredient to picture or price, and the
  // job's own text is the whole row.
  readonly ingredient: Ingredient | null;
}

export interface GuidedPrepJob {
  // The prep entry's id. Still the job's identity even when it is not a tick key.
  readonly id: string;
  readonly text: string;
  // Never empty: a job with ingredients gets one row each, in RECIPE order; a job
  // with none gets a single row keyed by the job itself.
  readonly rows: readonly GuidedPrepTickRow[];
}

export interface GuidedPrepCard {
  // The normalised container name — the group's identity, and `''` for the one
  // card holding every job that sets nothing aside.
  readonly key: string;
  // The name AS AUTHORED, from the first job that used it: the cook is about to
  // write this on a bowl and then read it back off a step note, so it has to be
  // the plan's own words. Null on the unheaded card.
  readonly name: string | null;
  readonly jobs: readonly GuidedPrepJob[];
  // Every tick id on this card, flattened in reading order. The card is done when
  // all of them are ticked, and its header count is over these — so what the
  // header counts and what the cook can see to tap are the same thing.
  //
  // NOT deduplicated. A plan may name one ingredient in two jobs of the same card
  // (nothing forbids it), which renders as two rows that tick together; counting
  // them once would leave the header reading 1/1 beside two visible rows.
  readonly tickIds: readonly string[];
}

export interface GuidedPrepBoard {
  // Grouped by normalised container name, in PLAN ORDER of first appearance — the
  // sequence the jobs themselves are in, so a plan written to be worked top to
  // bottom still reads that way. The unheaded card is not special-cased to an end
  // position: it takes its place by first appearance like any other group.
  readonly cards: readonly GuidedPrepCard[];
  // The ingredients this plan accounts for nowhere — rendered as its own "Also get
  // out" section rather than folded into a card, because it is not work the plan
  // asked for. Carried here so the board is EVERYTHING the prep screen shows, and
  // progress can be counted from the board alone.
  readonly alsoGetOut: readonly Ingredient[];
}

export function guidedPrepBoard(
  recipe: Recipe,
  prep: readonly GuidedPrepEntryDoc[],
): GuidedPrepBoard {
  const byKey = new Map<string, { key: string; name: string | null; jobs: GuidedPrepJob[] }>();

  for (const entry of prep) {
    // A blank container is the same fact as a null one, arrived at from a plan
    // that stored an empty string — both land on the unheaded card.
    const key = entry.container === null ? '' : normaliseContainerName(entry.container);
    let card = byKey.get(key);
    if (!card) {
      card = { key, name: key === '' ? null : entry.container!.trim(), jobs: [] };
      byKey.set(key, card);
    }
    const prepared = prepEntryIngredients(recipe, entry);
    card.jobs.push({
      id: entry.id,
      text: entry.text,
      rows:
        prepared.length > 0
          ? prepared.map((ingredient) => ({ id: ingredient.id, ingredient }))
          : [{ id: entry.id, ingredient: null }],
    });
  }

  // Map insertion order is first-appearance order.
  const cards = [...byKey.values()].map((card) => ({
    key: card.key,
    name: card.name,
    jobs: card.jobs,
    tickIds: card.jobs.flatMap((job) => job.rows.map((row) => row.id)),
  }));

  return { cards, alsoGetOut: unpreppedIngredients(recipe, prep) };
}
