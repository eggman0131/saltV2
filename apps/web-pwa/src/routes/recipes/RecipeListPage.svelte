<script lang="ts">
  import { Button, ListPage } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { recipes, isLoadingRecipes } from '../../lib/recipeService.js';

  const sorted = $derived([...$recipes].sort((a, b) => a.title.localeCompare(b.title)));

  function ingredientCount(recipe: (typeof sorted)[number]): number {
    return recipe.ingredients.reduce((n, g) => n + g.items.length, 0);
  }
</script>

<ListPage
  title="Recipes"
  description="Your recipe collection."
  isLoading={$isLoadingRecipes}
  isEmpty={sorted.length === 0}
  class="p-4 sm:p-6"
>
  {#snippet actions()}
    <Button size="sm" onclick={() => push('/recipes/new')} data-testid="recipe-new-btn">
      New recipe
    </Button>
  {/snippet}

  {#snippet empty()}
    <div class="flex flex-col items-center gap-3 py-12 text-center">
      <p class="text-sm text-muted-foreground">No recipes yet.</p>
      <Button size="sm" onclick={() => push('/recipes/new')}>Create your first recipe</Button>
    </div>
  {/snippet}

  {#snippet children()}
    <ul class="flex flex-col gap-1" data-testid="recipe-list">
      {#each sorted as recipe (recipe.id)}
        <li>
          <button
            class="w-full rounded px-2 py-2 text-left text-sm font-medium hover:bg-muted"
            onclick={() => push(`/recipes/${recipe.id}`)}
            data-testid="recipe-list-item"
            data-recipe-id={recipe.id}
          >
            {recipe.title}
            <span class="ml-2 text-xs font-normal text-muted-foreground">
              {ingredientCount(recipe)} ingredient{ingredientCount(recipe) === 1 ? '' : 's'}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/snippet}
</ListPage>
