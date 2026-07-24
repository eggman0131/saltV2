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
  import type { RecipeDiff, StepTimerDoc } from '@salt/domain/schemas';

  // Review-and-approve gate for an AI-chef recipe edit (issue-scoped Phase 2). Renders
  // the pure `RecipeDiff` produced by `diffRecipe` as a concise, section-grouped summary
  // of what will change — NOT a full before/after dump. Two choices only: Apply (commit
  // the merge + save, owned by the caller via `onApply`) or Discard / keep chatting
  // (drop the proposal, no write). A no-op diff (`hasChanges === false`) shows "No
  // changes" with nothing to apply. Self-contained review sheet, modelled on
  // RecipeAddToListSheet — both edit surfaces (chat page + recipe-view sidebar) reuse it
  // so the review UX is identical.
  interface Props {
    diff: RecipeDiff | null;
    open: boolean;
    applying: boolean;
    onApply: () => void;
    onDiscard: () => void;
  }
  let { diff, open = $bindable(), applying, onApply, onDiscard }: Props = $props();

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

  // Metadata field → readable label. Times get "min" via timeValue; servings is bare.
  const timeLabels: Record<'prepTimeMinutes' | 'cookTimeMinutes' | 'totalTimeMinutes', string> = {
    prepTimeMinutes: 'Prep time',
    cookTimeMinutes: 'Cook time',
    totalTimeMinutes: 'Total time',
  };

  // Ordered metadata rows to render (only the fields present in the diff).
  const metadataRows = $derived.by(() => {
    if (!diff) return [] as { label: string; text: string }[];
    const m = diff.metadata;
    const rows: { label: string; text: string }[] = [];
    if (m.servings)
      rows.push({
        label: 'Servings',
        text: `${servingsValue(m.servings.from)} → ${servingsValue(m.servings.to)}`,
      });
    for (const key of ['prepTimeMinutes', 'cookTimeMinutes', 'totalTimeMinutes'] as const) {
      const c = m[key];
      if (c)
        rows.push({
          label: timeLabels[key],
          text: `${timeValue(c.from)} → ${timeValue(c.to)}`,
        });
    }
    return rows;
  });

  // Whether the Timing & servings section has anything to show.
  const hasMetadata = $derived(metadataRows.length > 0);
  const hasTags = $derived(!!diff && (diff.tags.added.length > 0 || diff.tags.removed.length > 0));
  const hasIngredients = $derived(
    !!diff &&
      (diff.ingredients.added.length > 0 ||
        diff.ingredients.removed.length > 0 ||
        diff.ingredients.changed.length > 0),
  );
  const hasSteps = $derived(
    !!diff &&
      (diff.steps.added.length > 0 ||
        diff.steps.removed.length > 0 ||
        diff.steps.changed.length > 0),
  );
  const hasBasics = $derived(!!diff && (!!diff.title || !!diff.description || !!diff.notes));

  function nullableText(v: string | null): string {
    return v === null || v.trim() === '' ? 'none' : v;
  }
</script>

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
        <!-- Title / Description / Notes -->
        {#if hasBasics}
          <section class="flex flex-col gap-1.5" data-testid="recipe-change-group-basics">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Overview
            </h3>
            <ul class="flex flex-col gap-1">
              {#if diff.title}
                <li>Title: {diff.title.from} → {diff.title.to}</li>
              {/if}
              {#if diff.description}
                <li>
                  Description: {nullableText(diff.description.from)} → {nullableText(
                    diff.description.to,
                  )}
                </li>
              {/if}
              {#if diff.notes}
                <li>Notes: {nullableText(diff.notes.from)} → {nullableText(diff.notes.to)}</li>
              {/if}
            </ul>
          </section>
        {/if}

        <!-- Ingredients -->
        {#if hasIngredients}
          <section class="flex flex-col gap-1.5" data-testid="recipe-change-group-ingredients">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ingredients
            </h3>
            <ul class="flex flex-col gap-1">
              {#each diff.ingredients.added as ing (ing.id)}
                <li>Added: {ing.rawText}</li>
              {/each}
              {#each diff.ingredients.removed as ing (ing.id)}
                <li>Removed: {ing.rawText}</li>
              {/each}
              {#each diff.ingredients.changed as ing (ing.id)}
                <li>Changed: {ing.from} → {ing.to}</li>
              {/each}
            </ul>
          </section>
        {/if}

        <!-- Steps -->
        {#if hasSteps}
          <section class="flex flex-col gap-1.5" data-testid="recipe-change-group-steps">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Steps
            </h3>
            <ul class="flex flex-col gap-1">
              {#each diff.steps.added as step (step.id)}
                <li>Added: {step.text}</li>
              {/each}
              {#each diff.steps.removed as step (step.id)}
                <li>Removed: {step.text}</li>
              {/each}
              {#each diff.steps.changed as step (step.id)}
                {#if step.text}
                  <li>Step {step.position}: {step.text.from} → {step.text.to}</li>
                {/if}
                {#if step.timer}
                  <li>
                    Step {step.position} timer {timerLabel(step.timer.from)} → {timerLabel(
                      step.timer.to,
                    )}
                  </li>
                {/if}
                {#if step.note}
                  <li>
                    Step {step.position} note: {nullableText(step.note.from)} → {nullableText(
                      step.note.to,
                    )}
                  </li>
                {/if}
              {/each}
            </ul>
          </section>
        {/if}

        <!-- Timing & servings -->
        {#if hasMetadata}
          <section class="flex flex-col gap-1.5" data-testid="recipe-change-group-metadata">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Timing & servings
            </h3>
            <ul class="flex flex-col gap-1">
              {#each metadataRows as row (row.label)}
                <li>{row.label} {row.text}</li>
              {/each}
            </ul>
          </section>
        {/if}

        <!-- Tags -->
        {#if hasTags}
          <section class="flex flex-col gap-1.5" data-testid="recipe-change-group-tags">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tags
            </h3>
            <ul class="flex flex-col gap-1">
              {#each diff.tags.added as tag (tag)}
                <li>Tag added: {tag}</li>
              {/each}
              {#each diff.tags.removed as tag (tag)}
                <li>Tag removed: {tag}</li>
              {/each}
            </ul>
          </section>
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
