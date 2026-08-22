<script lang="ts">
  import type { Ingredient } from '@salt/domain';
  import type { QuantityDoc } from '@salt/domain/schemas';

  // The single source of truth for how one ingredient reads as text. RecipeViewPage
  // (the recipe detail page) and CookModePage (mise-en-place + per-step first-use)
  // both render through this, so the two surfaces can never drift: weight-first when
  // parsed to a metric measure, with the original measure as a muted "(…)" note, and
  // the raw line verbatim otherwise. The interactive canon-match (✗) affordance is
  // NOT part of this — RecipeViewPage appends it after.
  //
  // `part` splits that ONE rendering into pieces rather than forking the component
  // (issue #878): the recipe page lays an ingredient out as three columns — the
  // pictogram, the thing, the amount — so it asks for the pieces separately and
  // places them itself. The words are still written in exactly one place, so a
  // change to how an amount or a preparation reads still lands on both surfaces at
  // once. `all` is the default and renders every piece in reading order, which is
  // what CookModePage and GuidedCookPage keep asking for.
  //
  // The parts, and what each is for:
  //   quantity — the METRIC amount alone ("300g"). The recipe page's right column.
  //   name     — the thing and everything said ABOUT the thing: item, preparation,
  //              parenthetical notes, "(optional)". The recipe page's middle column.
  //   display  — the original non-metric measure alone ("(1 ½ cups)"). The recipe
  //              page puts this UNDER the metric amount, because "1 ½ cups" is a
  //              second way of saying 300g and belongs beside it, not trailing the
  //              end of a sentence about lentils. It carries its own `block` in
  //              that part rather than being wrapped by the caller, so a line with
  //              no non-metric measure renders NOTHING — a wrapper would leave an
  //              empty line box under every amount in the list.
  //
  // An UNPARSED line has no separable amount at all: `quantity` and `display` render
  // nothing and `name` carries the whole raw line. That is what keeps the recipe
  // page's name column straight down a part-parsed list instead of ragging in and
  // out.

  interface Props {
    ingredient: Ingredient;
    part?: 'all' | 'quantity' | 'name' | 'display';
  }
  let { ingredient, part = 'all' }: Props = $props();

  function formatMetricQty(q: QuantityDoc): string {
    if (q.type === 'range') return `${q.min}–${q.max}`;
    if (q.type === 'single') return String(q.value);
    return String(q.whole + q.numerator / q.denominator);
  }

  const parsed = $derived(ingredient.parsed);

  // The metric amount, or null when the line has none. This is also the test the
  // name half reads: a line without a metric measure shows its raw text, exactly
  // as the single-run template did.
  const metric = $derived(
    parsed && parsed.quantity && parsed.unit
      ? `${formatMetricQty(parsed.quantity)}${parsed.unit}`
      : null,
  );

  // Joined in script, separator included, rather than written as a bare ", " in
  // the template: the template below is whitespace-sensitive to the character,
  // and a line long enough for the formatter to wrap would silently turn
  // ", rinsed" into ",\n      rinsed" in the rendered text.
  //
  // The separating comma lives INSIDE the muted span with the words it belongs
  // to, so ", rinsed" steps down as one phrase. What the line is is the item; how
  // it arrives at the pan is an aside, and at `text-xs` the aside stops competing
  // with nineteen item names being scanned down a column.
  const preparation = $derived(
    parsed && parsed.preparation.length > 0 ? `, ${parsed.preparation.join(', ')}` : '',
  );

  // What the source said in brackets that was not a preparation — "from a jar",
  // "any colour". Parsed since the field was added and stored on every recipe
  // since, but never rendered anywhere until #878: it reached the shopping list
  // (recipeService carries it onto the item's notes) and simply vanished from the
  // recipe it came off. Shown here rather than at the two call sites so cook mode
  // gets it too — a note about which cream to use is worth as much at the counter.
  const notes = $derived(
    parsed && parsed.notes !== null && parsed.notes.trim() !== '' ? parsed.notes.trim() : null,
  );

  const showQuantity = $derived(part === 'all' || part === 'quantity');
  const showName = $derived(part === 'all' || part === 'name');
  const showDisplay = $derived(part === 'all' || part === 'display');
</script>

{#if showQuantity && metric}{metric}{/if}{#if part === 'all' && metric}{' '}{/if}{#if showName}{#if parsed && metric}{parsed.item}{#if preparation}<span
        class="text-xs text-muted-foreground">{preparation}</span
      >{/if}{:else}{ingredient.rawText}{/if}{#if notes}<span
      class="ml-1 text-xs text-muted-foreground">({notes})</span
    >{/if}{/if}{#if showDisplay && parsed && metric && parsed.displayText}<span
    class="text-xs text-muted-foreground"
    class:ml-1={part === 'all'}
    class:block={part === 'display'}>({parsed.displayText})</span
  >{/if}{#if showName && ingredient.isOptional}<span class="ml-1 text-xs text-muted-foreground"
    >(optional)</span
  >{/if}
