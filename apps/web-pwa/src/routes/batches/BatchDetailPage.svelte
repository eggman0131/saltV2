<script lang="ts">
  import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    DetailPage,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    EmptyState,
    Icon,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Spinner,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import type { DomainError } from '@salt/shared-types';
  import { goBack } from '../../lib/nav.js';
  import { abandonBatch, advanceStage, batch, initBatchSync } from '../../lib/batchService.js';
  import { addToast } from '../../lib/toastStore.js';
  import {
    formatDate,
    formatGrams,
    formatStatedDuration,
    formatWhen,
    isObservational,
    nextAction,
    yieldSummary,
  } from './batchDisplay.js';

  // One run (issue #812, phases 1 and 3 of epic #778) — `/batches/:id`.
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
  // ─── THE CONTROLS (issue #812, phase 3) ───────────────────────────────────────
  //
  // Phase 1 shipped this screen able only to READ, so a schedule could be checked
  // against a real bake before anything could act on one. Phase 3 adds the three
  // things that act, and nothing else:
  //
  //   • MARK A STAGE DONE, at the moment it actually is. That single write is what
  //     drives the whole reminder engine: `withStageAdvanced` re-times every later
  //     stage from the instant given, `onBatchWritten` re-queues the reminders whose
  //     `${stageId}@${plannedStartAt}` key changed, and finishing the bulk twenty
  //     minutes early therefore moves the shape, the bake AND every push by twenty
  //     minutes. Nothing here debounces or batches: the trigger's diff is what makes
  //     an unchanged reminder free, so a second tap costs a document write and no
  //     queue churn.
  //   • ABANDON the run — which stops its reminders, because dispatch re-reads the
  //     batch and no-ops on one that is not running.
  //   • HAND OFF TO COOK MODE, which is a link and nothing more.
  //
  // ONLY THE CURRENT STAGE IS ADVANCEABLE, and `nextAction` decides which that is —
  // the same function the in-flight list uses for its card, so the two surfaces can
  // never disagree about what a run wants next. Earlier stages are done, later ones
  // have not happened, and neither has a control. An abandoned or fully-done run has
  // no current stage at all and so shows none.
  //
  // ─── STILL NOT HERE, AND NOT BY OVERSIGHT ─────────────────────────────────────
  //
  // No re-scaling, no re-scheduling, and no route back to `proposeSchedule` from a
  // running batch. Freezing is what stops a batch growing versions: what a batch
  // records is what happened, so the only thing that ever moves on this screen is
  // the clock, and only as a consequence of a stage being marked done. Observations,
  // photos and a finished state are phase 4.
  //
  // The clock is NOT read here. `advanceStage` reads it in the service, which is why
  // every re-timing this screen triggers is a pure function with a fixed answer.

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

  // ─── What the run wants next ──────────────────────────────────────────────────
  //
  // Read through `nextAction` rather than re-derived, so "which stage is now" has
  // one answer across the list card and this page (see batchDisplay.ts). An id is
  // all the markup needs — comparing ids inside the `{#each}` is what keeps the
  // controls attached to the stage they act on rather than to a copy of it.
  const next = $derived(run ? nextAction(run) : null);
  const currentStageId = $derived(next?.kind === 'stage' ? next.stage.id : null);

  // Abandon is gated on the run's STATE and not on `nextAction`, because the two
  // answer different questions. `withBatchAbandoned` is idempotent, so an already
  // abandoned run has nothing to offer; a run whose every stage happens to be done
  // is still `running` and may still be stopped, since there is no `finished` state
  // for it to have reached instead (BatchStateSchema — phase 4's, if ever).
  const canAbandon = $derived(run !== null && run !== undefined && run.state === 'running');

  // ─── Failure copy ─────────────────────────────────────────────────────────────
  //
  // Only a ValidationError carries a sentence, and it is always one the user can act
  // on. Everything else has already been categorised and (where the policy says so)
  // reported by the service on its way through — docs/salt-architecture.md §7.6 —
  // so what is left to do here is say something true and let them try again.
  function failureMessage(error: DomainError, fallback: string): string {
    return error.kind === 'ValidationError' && error.message ? error.message : fallback;
  }

  // ─── Mark a stage done ────────────────────────────────────────────────────────

  // Which stage is in flight, rather than a bare boolean: the button that was tapped
  // is the one that shows the spinner, and a second tap on it does nothing while the
  // write is out.
  let advancingStageId = $state<string | null>(null);

  async function handleAdvance(stageId: string): Promise<void> {
    const current = run;
    if (!current || advancingStageId !== null) return;
    advancingStageId = stageId;
    const result = await advanceStage(current, stageId);
    advancingStageId = null;
    if (result.kind !== 'ok') {
      // No toast on success. The stage list re-times itself in front of you, which
      // is a far better acknowledgement than a sentence that covers it up.
      addToast(
        failureMessage(result.error, "Couldn't mark that stage done. Try again."),
        'destructive',
      );
    }
  }

  // ─── Abandon ──────────────────────────────────────────────────────────────────
  //
  // Behind the ⋮ AND behind a confirm, which is two gates for one action — because
  // abandoning is one-way (`withBatchAbandoned` has no inverse, and un-abandoning
  // would present hours-stale planned times as if they still meant something) and
  // because the thumb that reaches this page is reaching for "Mark done". Delete
  // ranks the same way on the recipe view, for the same reason.
  let overflowOpen = $state(false);
  let abandonOpen = $state(false);
  let abandoning = $state(false);

  async function handleAbandon(): Promise<void> {
    const current = run;
    if (!current || abandoning) return;
    abandoning = true;
    const result = await abandonBatch(current);
    abandoning = false;
    if (result.kind !== 'ok') {
      addToast(failureMessage(result.error, "Couldn't stop this batch. Try again."), 'destructive');
      return;
    }
    abandonOpen = false;
    // Stays on the page rather than navigating away: the log of how far it got is
    // the entire reason abandoning is a state and not a delete.
    addToast('Batch abandoned.', 'default');
  }
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
    <!-- ─── The ⋮ ──────────────────────────────────────────────────────────────
         One item, and deliberately so. A destructive, one-way action does not get
         a top-level slot beside the thing you came here to tap, and the header is
         where this page's precedent puts it (RecipeViewPage's Delete). The gate is
         on the whole menu rather than on the item, so the trigger can never open
         onto an empty popover — the rule the recipe view's menu keeps too. -->
    {#snippet actions()}
      {#if canAbandon}
        <Popover bind:open={overflowOpen}>
          <PopoverTrigger>
            {#snippet children()}
              <button
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="More actions"
                data-testid="batch-actions-overflow"
              >
                <Icon name="EllipsisVertical" size={20} />
              </button>
            {/snippet}
          </PopoverTrigger>
          <PopoverContent align="end" class="min-w-44 p-1">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
              onclick={() => {
                overflowOpen = false;
                abandonOpen = true;
              }}
              data-testid="batch-abandon-menu-item"
            >
              <Icon name="CircleSlash" size={14} />
              Abandon
            </button>
          </PopoverContent>
        </Popover>
      {/if}
    {/snippet}

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
              {@const isCurrent = stage.id === currentStageId}
              <li
                class="flex flex-col gap-1 rounded border border-border p-3"
                class:opacity-60={stage.actualEndAt !== null}
                class:border-primary={isCurrent}
                data-testid="batch-stage"
                data-stage-id={stage.id}
                data-current={isCurrent ? 'true' : null}
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

                <!-- ─── The controls, on the stage in hand and nowhere else ─────
                     "Done" is the write the whole reminder engine hangs off, so it
                     is the primary and it is tapped WHEN THE STAGE IS ACTUALLY
                     DONE, not when the clock says it should have been: early and
                     late are the same gesture and the schedule re-times either way.

                     COOK MODE rides beside it on an `active` stage. `active` is the
                     gate — the process's own definition of a stage the cook carries
                     out and is present for (ProcessStageKindSchema), which is
                     exactly when having the method in front of you helps. NOT the
                     label ("Bake" is a word three bread recipes spelled three ways,
                     which is why that field exists at all) and NOT `stepId`, which
                     an extraction is allowed to drop when the citation is
                     hallucinated — losing the bake its link for a reason that has
                     nothing to do with baking. The link carries only the recipe id
                     because cook mode takes only a recipe id: it lands at the top of
                     cook mode with its own timers, which is the whole hand-off (see
                     docs/formulas-schedules-batches.md) and needs no new machinery
                     at the sharp end. -->
                {#if isCurrent}
                  <div
                    class="flex flex-wrap items-center gap-2 pt-2"
                    data-testid="batch-stage-controls"
                  >
                    <Button
                      size="sm"
                      onclick={() => void handleAdvance(stage.id)}
                      loading={advancingStageId === stage.id}
                      disabled={advancingStageId !== null}
                      data-testid="batch-stage-advance"
                    >
                      {#snippet leading()}
                        <Icon name="Check" size={16} />
                      {/snippet}
                      Mark done
                    </Button>
                    {#if stage.kind === 'active'}
                      <Button
                        size="sm"
                        variant="outline"
                        onclick={() => push(`/recipes/${run.recipeId}/cook`)}
                        data-testid="batch-stage-cook"
                      >
                        {#snippet leading()}
                          <Icon name="CookingPot" size={16} />
                        {/snippet}
                        Cook mode
                      </Button>
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

<!-- ─── Abandon confirm ──────────────────────────────────────────────────────────
     Outside the `{#if}` so the dialog is not torn out from under itself if the
     write lands before the animation finishes. It says what abandoning does and
     what it does not: the run stops and its reminders stop with it, and the log of
     how far it got stays exactly where it is — which is the difference between this
     and a delete, and the reason there is no way back. -->
<Dialog
  bind:open={abandonOpen}
  onOpenChange={(v) => {
    if (!v) abandoning = false;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="batch-abandon-dialog">
      <DialogHeader>
        <DialogTitle>Abandon this batch?</DialogTitle>
        <DialogDescription>
          Its reminders stop. What it recorded stays — you just won't be asked about it again, and
          there's no way back.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (abandonOpen = false)} disabled={abandoning}>
          Keep going
        </Button>
        <Button
          variant="destructive"
          onclick={() => void handleAbandon()}
          loading={abandoning}
          disabled={abandoning}
          data-testid="batch-abandon-confirm"
        >
          Abandon
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
