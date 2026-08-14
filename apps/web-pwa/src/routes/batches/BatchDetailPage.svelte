<script lang="ts">
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    DetailPage,
    EmptyState,
    Icon,
    Spinner,
  } from '@salt/ui-components';
  import { goBack } from '../../lib/nav.js';
  import { batch, initBatchSync } from '../../lib/batchService.js';
  import {
    formatDate,
    formatGrams,
    formatStatedDuration,
    formatWhen,
    isObservational,
    yieldSummary,
  } from './batchDisplay.js';

  // One run (issue #812, phase 1 of epic #778) — `/batches/:id`.
  //
  // An ordinary AppShell route: desk work at the bench, not a hands-full mode, so no
  // entry in ./fullViewport.ts. No `fill` either — this page is simply tall and
  // `<main>` scrolls it (ui-spec-v07 §1.6).
  //
  // ─── EVERY NUMBER HERE IS THE BATCH'S OWN ─────────────────────────────────────
  //
  // This screen reads `batches/{id}` and NOTHING ELSE. It does not load the recipe,
  // it does not load the formula, and it never re-solves anything: the quantities,
  // the totals, the stage times and even the recipe's title were frozen when the run
  // started. Re-map the formula tomorrow, rename the dish, delete it outright — this
  // page still says what this batch was, which is the entire reason the document
  // repeats what the recipe already holds (see `schemas/batch.ts`).
  //
  // It is also why the ingredient list here is the ONLY place a scaled quantity is
  // ever shown. The recipe never shows scaled numbers
  // (docs/formulas-schedules-batches.md) — someone who opens the loaf and taps Cook
  // gets the recipe's own 500 g and never learns a formula exists.
  //
  // ─── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
  //
  // No "mark this stage done", no "abandon", no reminders, no observations. The
  // producers for the first two already exist in the domain and on `batchService`;
  // their controls are phase 3, and shipping the surface that READS before the one
  // that ACTS is what lets the schedule be checked against a real bake first.

  let { params }: { params?: { id?: string } } = $props();

  const batchId = $derived(params?.id ?? '');

  // Subscribe for as long as the page is open. The service resets its store on every
  // init, so moving between runs can never show the previous one's numbers.
  $effect(() => {
    if (!batchId) return;
    return initBatchSync(batchId);
  });

  // Three states, and they are all different sentences: `undefined` is still
  // loading, `null` is a link to a run that is not there, a document is the run.
  const run = $derived($batch);

  // What the schedule was anchored to. The first stage's planned start IS the start
  // that was chosen — phase 1 anchors `{ kind: 'startAt' }` — so there is nothing to
  // store separately and nothing to re-derive.
  const startsAt = $derived(run ? (run.stages[0]?.plannedStartAt ?? null) : null);
  const endsAt = $derived(run ? (run.stages[run.stages.length - 1]?.plannedEndAt ?? null) : null);
</script>

{#if run === undefined}
  <div class="flex justify-center p-8"><Spinner /></div>
{:else if run === null}
  <div class="p-6">
    <EmptyState title="Batch not found" description="It may have been deleted." />
  </div>
{:else}
  <DetailPage
    title={run.recipeTitle}
    subtitle={yieldSummary(run.totals)}
    onBack={() => goBack('/batches')}
    backLabel="Back"
    class="p-4 sm:p-6"
  >
    <div class="flex flex-col gap-4" data-testid="batch-detail">
      <p class="text-sm text-muted-foreground" data-testid="batch-detail-started">
        Started {formatDate(run.createdAt)}{#if run.state === 'abandoned'}
          · abandoned{/if}
      </p>

      <!-- ─── The scaled ingredient list ────────────────────────────────────────
           The frozen `label` is the recipe's own `rawText`, so it carries the
           recipe's as-written amount ("500 g strong white flour"). That is left
           alone rather than tidied: it is the line this run came from, and the
           figure you actually weigh is the one in the right-hand column, which is
           where the eye goes. -->
      <Card>
        <CardHeader>
          <CardTitle>Weigh out</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          <ul class="flex flex-col gap-2" data-testid="batch-quantities">
            {#each run.quantities as quantity (quantity.ingredientId)}
              <li
                class="flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
                data-testid="batch-quantity"
                data-ingredient-id={quantity.ingredientId}
              >
                <span class="min-w-0 flex-1 text-sm">
                  {#if quantity.label === ''}
                    <!-- An empty label means the ingredient had already left the
                         recipe when this run started. A blank reads as "we no longer
                         know what this was", which is true; an id reads as gibberish
                         and a guess reads as a fact. -->
                    <span class="italic text-muted-foreground">no longer in the recipe</span>
                  {:else}
                    {quantity.label}
                  {/if}
                </span>
                <span class="shrink-0 text-right">
                  <span class="block font-medium tabular-nums" data-testid="batch-quantity-grams">
                    {formatGrams(quantity.grams)}
                  </span>
                  <span class="block text-xs tabular-nums text-muted-foreground">
                    {quantity.percent}%
                  </span>
                </span>
              </li>
            {/each}
          </ul>

          <dl class="flex flex-col gap-1 pt-2 text-sm" data-testid="batch-totals">
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">In the bowl</dt>
              <dd class="tabular-nums" data-testid="batch-total-grams">
                {formatGrams(run.totals.totalGrams)}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">Off the bench</dt>
              <dd class="tabular-nums" data-testid="batch-usable-grams">
                {formatGrams(run.totals.usableGrams)}
              </dd>
            </div>
            {#if run.totals.units !== null}
              <div class="flex justify-between gap-3">
                <dt class="text-muted-foreground">Baked, each</dt>
                <dd class="tabular-nums" data-testid="batch-baked-each">
                  about {formatGrams(run.totals.units.bakedUnitGrams)}
                </dd>
              </div>
            {/if}
          </dl>

          <p class="text-xs text-muted-foreground" data-testid="batch-frozen-note">
            These were worked out when the batch started. Editing the recipe or its formula
            afterwards won't change a number here.
          </p>
        </CardContent>
      </Card>

      <!-- ─── The schedule ─────────────────────────────────────────────────────── -->
      <Card>
        <CardHeader>
          <CardTitle>The plan</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          {#if startsAt !== null && endsAt !== null}
            <p class="text-sm text-muted-foreground" data-testid="batch-schedule-span">
              From {formatWhen(startsAt)} to {formatWhen(endsAt)}.
            </p>
          {/if}

          <ol class="flex flex-col gap-2" data-testid="batch-stages">
            {#each run.stages as stage (stage.id)}
              {@const stated = formatStatedDuration(stage.duration)}
              <li
                class="flex flex-col gap-1 rounded border border-border p-3"
                class:opacity-60={stage.actualEndAt !== null}
                data-testid="batch-stage"
                data-stage-id={stage.id}
                data-planned-start={stage.plannedStartAt}
                data-planned-end={stage.plannedEndAt}
              >
                <div class="flex items-baseline justify-between gap-3">
                  <span class="min-w-0 flex-1 font-medium" data-testid="batch-stage-label">
                    {stage.label}
                  </span>
                  <span class="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                    {stage.kind === 'wait' ? 'wait' : 'active'}
                  </span>
                </div>

                <div class="flex flex-col gap-0.5 text-sm">
                  <span class="tabular-nums" data-testid="batch-stage-start">
                    Starts {formatWhen(stage.plannedStartAt)}
                  </span>
                  {#if isObservational(stage)}
                    <!-- A stage with no duration is scheduled at ZERO elapsed time —
                         `plannedEndAt` equals `plannedStartAt`. Printing that as a
                         span would read as an instant event, which is the one thing
                         it is not: the length is not zero and it is not infinite, it
                         is UNKNOWN (see `resolveSchedule`'s header). So it says so,
                         and says what everything after it therefore is. -->
                    <span class="text-muted-foreground" data-testid="batch-stage-observational">
                      No fixed time — you decide when it's ready, and the times below are the plan
                      as if this took none.
                    </span>
                  {:else}
                    <span class="tabular-nums text-muted-foreground" data-testid="batch-stage-end">
                      Ends {formatWhen(stage.plannedEndAt)}
                    </span>
                  {/if}
                </div>

                {#if stated !== null || stage.environment !== null || stage.until !== null}
                  <div
                    class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
                  >
                    {#if stated !== null}
                      <!-- What the RECIPE said, beside the single time the schedule
                           had to commit to. A range is scheduled at its long end and
                           keeps its whole span here, so "45–60 min" is still readable
                           against a clock that says 60. -->
                      <span data-testid="batch-stage-stated">
                        Recipe says {stated}{#if stage.duration?.kind === 'range'}, planned at the
                          long end{/if}
                      </span>
                    {/if}
                    {#if stage.environment !== null}
                      <span class="flex items-center gap-1" data-testid="batch-stage-environment">
                        <Icon name="Thermometer" size={12} />
                        {stage.environment.celsius} °C{#if stage.environment.relativeHumidityPercent !== undefined}
                          · {stage.environment.relativeHumidityPercent}% RH{/if}
                      </span>
                    {/if}
                    {#if stage.until !== null}
                      <span data-testid="batch-stage-until">{stage.until}</span>
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ol>
        </CardContent>
      </Card>
    </div>
  </DetailPage>
{/if}
