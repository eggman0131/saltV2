<script lang="ts">
  import type { Ingredient } from '@salt/domain';
  import type { QuantityDoc } from '@salt/domain/schemas';

  // The single source of truth for how one ingredient reads as text. RecipeViewPage
  // (the recipe detail page) and CookModePage (mise-en-place + per-step first-use)
  // both render through this, so the two surfaces can never drift: weight-first when
  // parsed to a metric measure, with the original measure as a muted "(…)" note, and
  // the raw line verbatim otherwise. The interactive canon-match (✗) affordance is
  // NOT part of this — RecipeViewPage appends it after.

  interface Props {
    ingredient: Ingredient;
  }
  let { ingredient }: Props = $props();

  function formatMetricQty(q: QuantityDoc): string {
    if (q.type === 'range') return `${q.min}–${q.max}`;
    if (q.type === 'single') return String(q.value);
    return String(q.whole + q.numerator / q.denominator);
  }
</script>

{#if ingredient.parsed?.quantity && ingredient.parsed?.unit}{formatMetricQty(
    ingredient.parsed.quantity,
  )}{ingredient.parsed.unit}
  {ingredient.parsed.item}{#if ingredient.parsed.preparation.length > 0}, {ingredient.parsed.preparation.join(
      ', ',
    )}{/if}{#if ingredient.parsed.displayText}<span class="ml-1 text-xs text-muted-foreground"
      >({ingredient.parsed.displayText})</span
    >{/if}{:else}{ingredient.rawText}{/if}{#if ingredient.isOptional}<span
    class="ml-1 text-xs text-muted-foreground">(optional)</span
  >{/if}
