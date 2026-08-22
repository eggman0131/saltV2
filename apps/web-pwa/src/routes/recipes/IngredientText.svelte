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
  // `part` splits that ONE rendering into its two halves rather than forking the
  // component (issue #878): the recipe page puts amounts in their own aligned
  // column, so it asks for the quantity and the name separately and lays them out
  // itself. The words are still written in exactly one place — `all` is literally
  // the quantity, a space, and the name — so a change to how an amount or a
  // preparation reads still lands on both surfaces at once. `all` is the default
  // and renders precisely what it always has, which is what CookModePage keeps
  // asking for.
  //
  // An UNPARSED line has no separable amount at all: `quantity` renders nothing
  // and `name` carries the whole raw line. That is what keeps the recipe page's
  // name column straight down a part-parsed list instead of ragging in and out.

  interface Props {
    ingredient: Ingredient;
    part?: 'all' | 'quantity' | 'name';
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
  const preparation = $derived(
    parsed && parsed.preparation.length > 0 ? `, ${parsed.preparation.join(', ')}` : '',
  );

  const showQuantity = $derived(part !== 'name' && metric !== null);
  const showName = $derived(part !== 'quantity');
</script>

{#if showQuantity}{metric}{/if}{#if part === 'all' && metric}{' '}{/if}{#if showName}{#if parsed && metric}{parsed.item}{preparation}{#if parsed.displayText}<span
        class="ml-1 text-xs text-muted-foreground">({parsed.displayText})</span
      >{/if}{:else}{ingredient.rawText}{/if}{#if ingredient.isOptional}<span
      class="ml-1 text-xs text-muted-foreground">(optional)</span
    >{/if}{/if}
