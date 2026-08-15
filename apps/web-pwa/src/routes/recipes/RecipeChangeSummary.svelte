<script lang="ts">
  import {
    Button,
    Icon,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
  } from '@salt/ui-components';
  import { diffWords, unchangedRatio } from '@salt/domain';
  import type { DiffPart } from '@salt/domain';
  import type { NullableStringChange, RecipeDiff, StepTimerDoc } from '@salt/domain/schemas';

  // Review-and-approve gate for an AI-chef recipe edit. Renders the pure
  // `RecipeDiff` produced by `diffRecipe` as a DIFF: one card per change,
  // grouped into the same five sections, each chipped with what kind of change
  // it is and labelled with what it applies to. Two choices only: Apply (commit
  // the merge + save, owned by the caller via `onApply`) or Discard / keep
  // chatting (drop the proposal, no write). A no-op diff (`hasChanges === false`)
  // shows "No changes" with nothing to apply. Self-contained review sheet; both
  // edit surfaces (chat page + recipe-view sidebar) reuse it so the review UX is
  // identical.
  //
  // It replaced a flat list that drew every edit as the whole old value, an
  // arrow, and the whole new value: on a real house-rules refresh that came to
  // 31 rows and 4,264 characters, the worst of them 493 characters of two
  // paragraphs joined by an arrow on a 390px phone. You could not tell
  // "reworded three words" from "replaced the sentence", so the only safe read
  // was to read all of it (issue #825).
  //
  // HOW a change is drawn is derived from the change itself and never chosen per
  // field — there are exactly three renderings, picked by `makeCard` below.
  interface Props {
    diff: RecipeDiff | null;
    open: boolean;
    applying: boolean;
    onApply: () => void;
    onDiscard: () => void;
  }
  let { diff, open = $bindable(), applying, onApply, onDiscard }: Props = $props();

  // ── Rendering thresholds ───────────────────────────────────────────────────
  // Presentation policy, deliberately NOT in the domain: `diffWords` decides what
  // moved, these two decide how it should look. Both were tuned against a real
  // refresh and a real chat amendment on staging data.

  // Where a value stops being a value and starts being prose. Under this on both
  // sides, an edit stays on one line as `750 g → 1.1 kg` — exactly as compact as
  // the flat list it replaced, and no word-level marks to read.
  const SHORT_VALUE_MAX = 42;

  // Where "the same sentence, adjusted" becomes "a different sentence". Below
  // this share of surviving content, interleaving word marks through the passage
  // produces dozens of alternating fragments that take longer to read than
  // either version alone — so it stops pretending to be an edit and shows the
  // old struck through above the new.
  const REWRITE_RATIO_FLOOR = 0.4;

  // ── Card model ─────────────────────────────────────────────────────────────
  // `from`/`to` are null when that side does not exist (an added ingredient has
  // no `from`). `mode` and `parts` are derived from the content, once, here.
  type ChangeKind = 'new' | 'gone' | 'edit';
  type RenderMode = 'value' | 'inline' | 'rewritten';

  interface ChangeCard {
    key: string;
    kind: ChangeKind;
    label: string;
    from: string | null;
    to: string | null;
    mode: RenderMode;
    parts: DiffPart[];
  }

  function makeCard(
    key: string,
    label: string,
    kind: ChangeKind,
    from: string | null,
    to: string | null,
  ): ChangeCard {
    // One side missing, or both sides short enough to sit on a line: nothing to
    // word-diff. Otherwise let the content pick between marks and a rewrite.
    if (from === null || to === null)
      return { key, label, kind, from, to, mode: 'value', parts: [] };
    if (from.length <= SHORT_VALUE_MAX && to.length <= SHORT_VALUE_MAX)
      return { key, label, kind, from, to, mode: 'value', parts: [] };
    const parts = diffWords(from, to);
    return unchangedRatio(parts) >= REWRITE_RATIO_FLOOR
      ? { key, label, kind, from, to, mode: 'inline', parts }
      : { key, label, kind, from, to, mode: 'rewritten', parts: [] };
  }

  // ── Friendly line builders ─────────────────────────────────────────────────
  function timerLabel(t: StepTimerDoc | null): string {
    if (!t) return 'no timer';
    return t.description
      ? `${t.durationMinutes} min (${t.description})`
      : `${t.durationMinutes} min`;
  }

  function timeValue(n: number | null): string {
    return n === null ? 'none' : `${n} min`;
  }

  function servingsValue(n: number | null): string {
    return n === null ? 'none' : String(n);
  }

  // Prose absence is a real change of kind: a description that did not exist is
  // "new", not an edit of the word "none". A number or a timer is different —
  // unset still has a readable one-line value ("none", "no timer"), so those stay
  // ordinary edits. Both sides blank (null ↔ "") is not a human-visible change at
  // all, so it yields no card rather than an empty one.
  function textOrNull(v: string | null): string | null {
    return v === null || v.trim() === '' ? null : v;
  }

  function proseCard(key: string, label: string, change: NullableStringChange): ChangeCard | null {
    const from = textOrNull(change.from);
    const to = textOrNull(change.to);
    if (from === null && to === null) return null;
    const kind: ChangeKind = from === null ? 'new' : to === null ? 'gone' : 'edit';
    return makeCard(key, label, kind, from, to);
  }

  // Metadata field → readable label. Times get "min" via timeValue; servings is bare.
  const timeLabels: Record<'prepTimeMinutes' | 'cookTimeMinutes' | 'totalTimeMinutes', string> = {
    prepTimeMinutes: 'Prep time',
    cookTimeMinutes: 'Cook time',
    totalTimeMinutes: 'Total time',
  };

  // ── Cards, per section, in a stable order ──────────────────────────────────
  const basicsCards = $derived.by(() => {
    if (!diff) return [] as ChangeCard[];
    const cards: ChangeCard[] = [];
    if (diff.title) cards.push(makeCard('title', 'Title', 'edit', diff.title.from, diff.title.to));
    const description =
      diff.description && proseCard('description', 'Description', diff.description);
    if (description) cards.push(description);
    const notes = diff.notes && proseCard('notes', 'Notes', diff.notes);
    if (notes) cards.push(notes);
    return cards;
  });

  // An ingredient card names the item, not the group it sits in: `RecipeDiff`
  // flattens ingredients across groups and carries only id + rawText, so the
  // group is not knowable from the data this component is given (issue #825).
  const INGREDIENT_LABEL = 'Ingredient';

  const ingredientCards = $derived.by(() => {
    if (!diff) return [] as ChangeCard[];
    const cards: ChangeCard[] = [];
    for (const ing of diff.ingredients.added)
      cards.push(makeCard(`ing-new-${ing.id}`, INGREDIENT_LABEL, 'new', null, ing.rawText));
    for (const ing of diff.ingredients.removed)
      cards.push(makeCard(`ing-gone-${ing.id}`, INGREDIENT_LABEL, 'gone', ing.rawText, null));
    for (const ing of diff.ingredients.changed)
      cards.push(makeCard(`ing-edit-${ing.id}`, INGREDIENT_LABEL, 'edit', ing.from, ing.to));
    return cards;
  });

  const stepCards = $derived.by(() => {
    if (!diff) return [] as ChangeCard[];
    const cards: ChangeCard[] = [];
    for (const step of diff.steps.added)
      cards.push(makeCard(`step-new-${step.id}`, `Step ${step.position}`, 'new', null, step.text));
    for (const step of diff.steps.removed)
      cards.push(
        makeCard(`step-gone-${step.id}`, `Step ${step.position}`, 'gone', step.text, null),
      );
    // text / timer / note are independent facets of one changed step, so a single
    // step can contribute up to three cards — each is a separate thing to read.
    for (const step of diff.steps.changed) {
      if (step.text)
        cards.push(
          makeCard(
            `step-edit-${step.id}`,
            `Step ${step.position}`,
            'edit',
            step.text.from,
            step.text.to,
          ),
        );
      if (step.timer)
        cards.push(
          makeCard(
            `step-timer-${step.id}`,
            `Step ${step.position} timer`,
            'edit',
            timerLabel(step.timer.from),
            timerLabel(step.timer.to),
          ),
        );
      if (step.note) {
        const note = proseCard(`step-note-${step.id}`, `Step ${step.position} note`, step.note);
        if (note) cards.push(note);
      }
    }
    return cards;
  });

  // Ordered metadata cards (only the fields present in the diff).
  const metadataCards = $derived.by(() => {
    if (!diff) return [] as ChangeCard[];
    const m = diff.metadata;
    const cards: ChangeCard[] = [];
    if (m.servings)
      cards.push(
        makeCard(
          'servings',
          'Servings',
          'edit',
          servingsValue(m.servings.from),
          servingsValue(m.servings.to),
        ),
      );
    for (const key of ['prepTimeMinutes', 'cookTimeMinutes', 'totalTimeMinutes'] as const) {
      const c = m[key];
      if (c) cards.push(makeCard(key, timeLabels[key], 'edit', timeValue(c.from), timeValue(c.to)));
    }
    return cards;
  });

  const tagCards = $derived.by(() => {
    if (!diff) return [] as ChangeCard[];
    const cards: ChangeCard[] = [];
    for (const tag of diff.tags.added)
      cards.push(makeCard(`tag-new-${tag}`, 'Tag', 'new', null, tag));
    for (const tag of diff.tags.removed)
      cards.push(makeCard(`tag-gone-${tag}`, 'Tag', 'gone', tag, null));
    return cards;
  });

  // Whether each section has anything to show. An empty section renders NOTHING —
  // not an empty shell — which is the signal both e2e specs read as "the chef
  // proposed no change here" via toHaveCount(0).
  const hasBasics = $derived(basicsCards.length > 0);
  const hasIngredients = $derived(ingredientCards.length > 0);
  const hasSteps = $derived(stepCards.length > 0);
  const hasMetadata = $derived(metadataCards.length > 0);
  const hasTags = $derived(tagCards.length > 0);

  // ── Surfaces ───────────────────────────────────────────────────────────────
  // The sage container marks what arrives, its destructive counterpart what
  // leaves — symmetric on purpose, so a removal does not read weaker than an
  // addition on a phone. Both are @salt/ui-components tokens.
  const ADDED = 'rounded-sm bg-secondary-container px-1 text-secondary-container-foreground';
  const REMOVED = 'rounded-sm bg-destructive-container px-1 text-destructive-container-foreground';
  const CHIP = 'rounded-sm px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider';

  function chipLabel(card: ChangeCard): string {
    if (card.kind !== 'edit') return card.kind;
    return card.mode === 'rewritten' ? 'rewritten' : 'edit';
  }

  function chipClass(card: ChangeCard): string {
    if (card.kind === 'new')
      return `${CHIP} bg-secondary-container text-secondary-container-foreground`;
    if (card.kind === 'gone')
      return `${CHIP} bg-destructive-container text-destructive-container-foreground`;
    return `${CHIP} bg-muted text-muted-foreground`;
  }
</script>

<!--
  One card, drawn by whichever of the three renderings its content chose.
  `recipe-change-proposed` marks the element holding exactly the proposed value,
  so a spec can assert the new value directly rather than against text that
  word-level marks have split into fragments. The inline rendering has no such
  element by construction — its whole point is that old and new are interleaved
  in place — so it carries `recipe-change-inline` instead.
-->
{#snippet changeCard(card: ChangeCard)}
  <li class="flex flex-col gap-1.5 rounded border border-border bg-card p-2.5">
    <div class="flex items-baseline gap-2">
      <span class={chipClass(card)}>{chipLabel(card)}</span>
      <span class="text-xs text-muted-foreground">{card.label}</span>
    </div>

    {#if card.mode === 'value'}
      <p class="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        {#if card.from !== null}
          <span class={card.kind === 'gone' ? `${REMOVED} line-through` : 'text-muted-foreground'}>
            {card.from}
          </span>
        {/if}
        {#if card.from !== null && card.to !== null}
          <span class="text-muted-foreground">→</span>
        {/if}
        {#if card.to !== null}
          <span
            class={card.kind === 'new' ? ADDED : 'font-medium'}
            data-testid="recipe-change-proposed"
          >
            {card.to}
          </span>
        {/if}
      </p>
    {:else if card.mode === 'inline'}
      <p data-testid="recipe-change-inline">
        {#each card.parts as part, i (i)}
          {#if part.kind === 'same'}{part.text}{:else if part.kind === 'del'}<del
              class={`${REMOVED} decoration-1`}>{part.text}</del
            >{:else}<ins class={`${ADDED} no-underline`}>{part.text}</ins>{/if}
        {/each}
      </p>
    {:else}
      <p class={`${REMOVED} line-through`}>{card.from}</p>
      <p data-testid="recipe-change-proposed">{card.to}</p>
    {/if}
  </li>
{/snippet}

{#snippet group(testid: string, heading: string, cards: ChangeCard[])}
  <section class="flex flex-col gap-1.5" data-testid={testid}>
    <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{heading}</h3>
    <ul class="flex flex-col gap-2">
      {#each cards as card (card.key)}
        {@render changeCard(card)}
      {/each}
    </ul>
  </section>
{/snippet}

<Sheet bind:open side="bottom">
  <SheetContent class="flex max-h-[85vh] flex-col gap-4 p-4 pb-8">
    <SheetHeader>
      <SheetTitle>Review changes</SheetTitle>
      <SheetDescription>
        {#if diff?.hasChanges}
          Here's what the chef will change. Nothing is saved until you apply.
        {:else}
          The chef didn't propose any changes to this recipe.
        {/if}
      </SheetDescription>
    </SheetHeader>

    <div class="flex flex-col gap-4 overflow-y-auto text-sm" data-testid="recipe-change-summary">
      {#if !diff || !diff.hasChanges}
        <p class="py-6 text-center text-muted-foreground" data-testid="recipe-change-summary-none">
          No changes.
        </p>
      {:else}
        {#if hasBasics}
          {@render group('recipe-change-group-basics', 'Overview', basicsCards)}
        {/if}
        {#if hasIngredients}
          {@render group('recipe-change-group-ingredients', 'Ingredients', ingredientCards)}
        {/if}
        {#if hasSteps}
          {@render group('recipe-change-group-steps', 'Steps', stepCards)}
        {/if}
        {#if hasMetadata}
          {@render group('recipe-change-group-metadata', 'Timing & servings', metadataCards)}
        {/if}
        {#if hasTags}
          {@render group('recipe-change-group-tags', 'Tags', tagCards)}
        {/if}
      {/if}
    </div>

    <SheetFooter class="flex justify-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        onclick={onDiscard}
        disabled={applying}
        data-testid="recipe-change-discard"
      >
        {diff?.hasChanges ? 'Discard / keep chatting' : 'Close'}
      </Button>
      {#if diff?.hasChanges}
        <Button
          size="sm"
          onclick={onApply}
          loading={applying}
          disabled={applying}
          data-testid="recipe-change-apply"
        >
          {#snippet leading()}<Icon name="Check" size={14} />{/snippet}
          Apply changes
        </Button>
      {/if}
    </SheetFooter>
  </SheetContent>
</Sheet>
