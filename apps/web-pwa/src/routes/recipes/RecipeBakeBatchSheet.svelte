<script lang="ts">
  import {
    Button,
    Icon,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    TextField,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    UNIT_SHAPE_PRESETS,
    flattenIngredients,
    solveFormula,
    targetYield,
    unitShapeFromPreset,
    unitShapePreset,
    type Recipe,
  } from '@salt/domain';
  import type { Formula } from '@salt/domain/schemas';
  import { startBatch } from '../../lib/batchService.js';
  import { addToast } from '../../lib/toastStore.js';

  // "Bake a batch" (issue #812, phase 1 of epic #778) — the scale sheet.
  //
  // Two questions and nothing else: WHAT are you making this time, and WHEN are you
  // starting. Answering them freezes a run and opens it.
  //
  // ─── THE ONE PLACE A SCALED NUMBER APPEARS BEFORE THE BATCH EXISTS ────────────
  //
  // docs/formulas-schedules-batches.md is emphatic: the recipe never shows scaled
  // numbers, and scaled quantities live on the batch. This sheet is the sanctioned
  // exception, because you cannot ask for twelve rolls without being shown what
  // twelve rolls weigh out to. Two rules keep the exception from spreading:
  //
  //   • IT WRITES NOTHING TO THE RECIPE, and nothing to the formula either. Closing
  //     it leaves both documents exactly as they were, so the weekly loaf can never
  //     silently become twelve rolls.
  //   • THE PREVIEW IS THE SAME ARITHMETIC THE FREEZE WILL DO. It calls the same
  //     `solveFormula` with the same yield and joins the same labels, so what is on
  //     screen is what lands on the document — not an approximation of it.
  //
  // ─── PHASE 1 IS `startAt`, DELIBERATELY ───────────────────────────────────────
  //
  // You say when you are mixing and the process is timed forward from it, by
  // arithmetic. "Out of the oven at 07:30" is the other half of `ScheduleAnchor` and
  // the schedule resolver already back-solves it to the minute — but asking for a
  // finish time is only useful once something can RESTRUCTURE the process to hit it
  // (ninety minutes on the counter becoming twenty on the counter and eight in the
  // fridge), and that is the phase-2 proposal flow. Offering the input before then
  // would promise a schedule the arithmetic cannot reshape.
  //
  // The start uses a native `datetime-local` input rather than a hand-rolled picker.
  // `RecipeAddToPlannerSheet` rejected the native control for its calendar and was
  // right to: a month grid has to start on the household's own first day of the
  // week, which no OS control knows. An instant carries no such convention — it is a
  // date and a time and nothing else — so the native control is simply correct here,
  // and it is one control fewer to maintain.

  interface Props {
    recipe: Recipe;
    formula: Formula;
    open: boolean;
  }
  let { recipe, formula, open = $bindable() }: Props = $props();

  // ─── When ─────────────────────────────────────────────────────────────────────

  function pad(value: number): string {
    return String(value).padStart(2, '0');
  }

  /** Now, in the `YYYY-MM-DDTHH:mm` local form a `datetime-local` input wants. */
  function localNow(): string {
    const at = new Date();
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }

  let startLocal = $state(localNow());

  // A `datetime-local` value has no offset, so it is read as LOCAL time — which is
  // what the person typing it means. `null` while the box is empty or half-typed.
  const startIso = $derived.by(() => {
    const ms = new Date(startLocal).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  });

  // ─── What ─────────────────────────────────────────────────────────────────────

  let presetId = $state('');
  let countText = $state('1');
  let busy = $state(false);
  // Why the run could not be started, in the service's own words. Rendered rather
  // than toasted: every one of these is a sentence that tells you where to go next,
  // and a toast that vanishes is the wrong home for an instruction.
  let startError = $state<string | null>(null);

  /**
   * Seed from the formula's OWN reference yield — "the recipe as written" is the
   * answer most runs want, and it should be sitting in the boxes rather than waiting
   * to be typed.
   *
   * A shape the preset list does not recognise leaves the picker empty, which is not
   * a failure state: an empty picker means "as written", and the solve falls back to
   * `formula.referenceYield` for exactly the same answer.
   */
  function seed(): void {
    startLocal = localNow();
    startError = null;
    if (formula.referenceYield.kind === 'target') {
      const shape = formula.referenceYield.shape;
      const preset = UNIT_SHAPE_PRESETS.find(
        (p) => p.label === shape.label && p.unitDoughGrams === shape.unitDoughGrams,
      );
      presetId = preset?.id ?? '';
      countText = String(shape.count);
    } else {
      presetId = '';
      countText = '1';
    }
  }

  // Re-seed on each open: a sheet reopened this evening must not still be offering
  // this morning's start time, and last run's count is not this run's.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) seed();
    wasOpen = open;
  });

  const selectedPreset = $derived(presetId ? unitShapePreset(presetId) : null);
  const count = $derived.by(() => {
    const value = Number(countText.trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const shape = $derived(
    selectedPreset && count !== null ? unitShapeFromPreset(selectedPreset, count) : null,
  );
  // Omitted, never invented: no shape means the formula's own reference yield, which
  // is precisely what `startBatch` does with an absent `atYield`.
  const atYield = $derived(shape === null ? null : targetYield(shape));

  // ─── The preview ──────────────────────────────────────────────────────────────

  const solved = $derived(solveFormula(formula, atYield ?? formula.referenceYield));

  // The recipe's own `rawText`, keyed by ingredient id — the same join `startBatch`
  // makes when it freezes the labels onto the run, so the preview and the document
  // read identically.
  const labelById = $derived(
    new Map(flattenIngredients(recipe).map((ingredient) => [ingredient.id, ingredient.rawText])),
  );

  const unsolvable = $derived.by(() => {
    if (solved.ok) return null;
    switch (solved.reason.kind) {
      case 'emptyFormula':
        return 'This formula has nothing in it yet.';
      case 'noBasis':
        return 'This formula has no basis — nothing is marked as the 100%.';
      case 'basisNotNormalised':
        return "This formula's basis doesn't add up to 100%.";
      default:
        return "This formula doesn't resolve into weights.";
    }
  });

  function formatGrams(grams: number): string {
    return `${grams} g`;
  }

  // ─── Start ────────────────────────────────────────────────────────────────────

  const canStart = $derived(!busy && solved.ok && startIso !== null);

  async function handleStart(): Promise<void> {
    if (!canStart || startIso === null) return;
    busy = true;
    startError = null;
    const result = await startBatch({
      recipe,
      formula,
      ...(atYield === null ? {} : { atYield }),
      anchor: { kind: 'startAt', at: startIso },
    });
    busy = false;
    if (result.kind !== 'ok') {
      // BATCH_NOT_STARTABLE carries a human sentence and is deliberately NOT
      // reported to PostHog — somebody typed the percentages, or the formula has no
      // stages yet, and both are ordinary flow with an obvious next step. Anything
      // else has already been reported by the service on its way through.
      startError =
        result.error.kind === 'ValidationError' && result.error.message
          ? result.error.message
          : "Couldn't start this batch. Try again.";
      return;
    }
    open = false;
    addToast('Batch started.', 'success');
    push(`/batches/${result.value.id}`);
  }
</script>

<Sheet
  bind:open
  side="bottom"
  onOpenChange={(v) => {
    if (!v) busy = false;
  }}
>
  <SheetContent class="flex max-h-[85vh] flex-col gap-4 p-4 pb-8">
    <SheetHeader>
      <SheetTitle>Bake a batch</SheetTitle>
    </SheetHeader>

    <p class="-mt-2 truncate text-sm text-muted-foreground" data-testid="bake-batch-recipe-title">
      {recipe.title}
    </p>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-testid="bake-batch-sheet">
      <!-- ─── What are you making this time? ──────────────────────────────────── -->
      <div class="flex flex-wrap items-end gap-3">
        <TextField
          label="How many"
          inputmode="numeric"
          class="w-28"
          value={countText}
          onValueChange={(v) => (countText = v)}
          data-autofocus
          data-testid="bake-batch-count"
        />
        <!-- No `portal` prop: SheetContent publishes itself as the portal container,
             so the listbox opens inside the sheet rather than behind the modal's
             pointer-events barrier (ui-spec-v03 §5; issues #674/#640). -->
        <Select value={presetId} onValueChange={(v) => (presetId = v)}>
          <SelectTrigger
            class="w-56"
            aria-label="What are you making"
            data-testid="bake-batch-shape"
          >
            {selectedPreset?.label ?? 'As written'}
          </SelectTrigger>
          <SelectContent>
            {#each UNIT_SHAPE_PRESETS as preset (preset.id)}
              <SelectItem value={preset.id}>{preset.label}</SelectItem>
            {/each}
          </SelectContent>
        </Select>
      </div>

      <!-- ─── What that weighs out to ─────────────────────────────────────────── -->
      {#if solved.ok}
        <ul class="flex flex-col gap-1" data-testid="bake-batch-preview">
          {#each solved.solution.components as component (component.ingredientId)}
            <li
              class="flex items-baseline justify-between gap-3 text-sm"
              data-testid="bake-batch-preview-row"
              data-ingredient-id={component.ingredientId}
            >
              <span class="min-w-0 flex-1 truncate">
                {labelById.get(component.ingredientId) ?? ''}
              </span>
              <span
                class="shrink-0 font-medium tabular-nums"
                data-testid="bake-batch-preview-grams"
              >
                {formatGrams(component.grams)}
              </span>
            </li>
          {/each}
        </ul>

        <div class="flex flex-col gap-0.5 text-sm" data-testid="bake-batch-totals">
          <p>
            <span class="font-medium tabular-nums" data-testid="bake-batch-total-grams">
              {formatGrams(solved.solution.totalGrams)}
            </span>
            in the bowl{#if formula.handlingLossPercent > 0}, including {formula.handlingLossPercent}%
              for what stays in it{/if}.
          </p>
          {#if solved.solution.units !== null}
            <p class="text-muted-foreground" data-testid="bake-batch-baked-each">
              {solved.solution.units.count} × {solved.solution.units.label} — about {formatGrams(
                solved.solution.units.bakedUnitGrams,
              )} each once baked.
            </p>
          {/if}
        </div>
      {:else}
        <p class="text-sm text-muted-foreground" data-testid="bake-batch-unsolvable">
          {unsolvable} Open the formula screen to sort it out.
        </p>
      {/if}

      <!-- ─── When are you starting? ──────────────────────────────────────────── -->
      <div class="flex flex-col gap-2">
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium">Starting</span>
          <input
            type="datetime-local"
            class="salt-focus-ring w-full rounded border border-input bg-background px-3 py-2 text-sm"
            bind:value={startLocal}
            data-testid="bake-batch-start"
          />
        </label>
        <div>
          <Button
            size="sm"
            variant="ghost"
            onclick={() => (startLocal = localNow())}
            data-testid="bake-batch-start-now"
          >
            {#snippet leading()}<Icon name="Clock" size={14} />{/snippet}
            Now
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Every stage is timed forward from here. Marking one done later moves the rest with it.
        </p>
      </div>

      {#if startError !== null}
        <p class="text-sm text-destructive" data-testid="bake-batch-error">{startError}</p>
      {/if}
    </div>

    <SheetFooter class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={busy}
        >Cancel</Button
      >
      <Button
        size="sm"
        onclick={handleStart}
        loading={busy}
        disabled={!canStart}
        data-testid="bake-batch-confirm"
      >
        Start
      </Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
