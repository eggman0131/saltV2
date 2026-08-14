<script lang="ts">
  import { Icon, ListPage } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { batches, initBatchesSync } from '../../lib/batchService.js';
  import {
    formatGrams,
    formatWhen,
    nextAction,
    orderBatches,
    yieldSummary,
  } from './batchDisplay.js';

  // The in-flight surface (issue #812, phase 1 of epic #778) — `/batches`.
  //
  // The day-to-day home of this whole epic, and the thing that does not exist in any
  // form today: "Coppa — day 12, weigh Friday", "Kraut — day 5, taste it". A formula
  // is opened once a month; THIS is opened every morning, which is why it is a nav
  // destination rather than a tab on a recipe.
  //
  // FAMILY-SHARED, so it is deliberately not part of "Kitchen" (issue #634), which
  // is a per-user projection. Either partner may glance at the crock.
  //
  // EVERY CARD SAYS ONE THING: the next action and when. That is the whole card
  // shape, and it is the shape a culture's "next feed" would take too if phase 03
  // ever lands one — same card, different noun.
  //
  // An ordinary AppShell list page: no `fill` (nothing here owns its own scrolling —
  // ui-spec-v05 §1.5), no selection mode, no bulk actions. Nothing on this screen
  // WRITES: advancing a stage and abandoning a run are phase 3's controls, and this
  // phase deliberately ships the surface that reads before the surface that acts.

  // The collection, for as long as the surface is open. `undefined` is the
  // not-loaded state; an empty array is loaded-and-nothing-running, which is a
  // different sentence and gets the empty snippet rather than the spinner.
  $effect(() => initBatchesSync());

  const ordered = $derived(orderBatches($batches ?? []));
</script>

<ListPage
  title="Batches"
  description="What's on the go, and what each one wants next."
  isLoading={$batches === undefined}
  isEmpty={ordered.length === 0}
  class="p-4 sm:p-6"
  data-testid="batch-list-page"
>
  {#snippet empty()}
    <div class="flex flex-col items-center gap-2 py-12 text-center" data-testid="batch-list-empty">
      <p class="text-sm text-muted-foreground">Nothing on the go.</p>
      <p class="max-w-sm text-sm text-muted-foreground">
        Open a recipe you've written a formula for and tap "Bake a batch" — the run turns up here
        with its next step and the time it lands.
      </p>
    </div>
  {/snippet}

  {#snippet children()}
    <ul class="flex flex-col gap-2" data-testid="batch-list">
      {#each ordered as batch (batch.id)}
        {@const next = nextAction(batch)}
        <li>
          <!-- The whole card is the target. A run has exactly one thing you can do
               with it from here — open it — so a row with a separate affordance
               would be a smaller tap area for no additional choice. -->
          <button
            type="button"
            class="flex w-full flex-col gap-1 rounded border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-accent"
            class:opacity-60={next.kind !== 'stage'}
            onclick={() => push(`/batches/${batch.id}`)}
            data-testid="batch-card"
            data-batch-id={batch.id}
            data-next-at={next.kind === 'stage' ? next.stage.plannedStartAt : ''}
          >
            <span class="flex items-baseline justify-between gap-3">
              <span class="min-w-0 flex-1 truncate font-medium" data-testid="batch-card-title">
                {batch.recipeTitle}
              </span>
              <span class="shrink-0 text-xs text-muted-foreground" data-testid="batch-card-yield">
                {yieldSummary(batch.totals)}
              </span>
            </span>

            <!-- THE LINE THIS SCREEN EXISTS FOR. A run with nothing left to do says
                 so plainly rather than borrowing the shape of one that is waiting on
                 you: an empty "next" reads as a bug, and "all done" reads as a log. -->
            {#if next.kind === 'stage'}
              <span class="flex items-center gap-2 text-sm" data-testid="batch-card-next">
                <Icon name="Hourglass" size={14} class="text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate">{next.stage.label}</span>
                <span class="shrink-0 tabular-nums text-muted-foreground">
                  {formatWhen(next.stage.plannedStartAt)}
                </span>
              </span>
            {:else if next.kind === 'done'}
              <span class="flex items-center gap-2 text-sm" data-testid="batch-card-next">
                <Icon name="Check" size={14} class="text-muted-foreground" />
                <span>Every stage done.</span>
              </span>
            {:else}
              <span class="flex items-center gap-2 text-sm" data-testid="batch-card-next">
                <Icon name="CircleSlash" size={14} class="text-muted-foreground" />
                <span>Abandoned.</span>
              </span>
            {/if}

            <span class="text-xs text-muted-foreground">
              {formatGrams(batch.totals.totalGrams)} in total
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/snippet}
</ListPage>
