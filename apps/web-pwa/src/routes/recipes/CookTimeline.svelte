<script lang="ts">
  import { progressOver } from '@salt/domain';
  import type { StepDoc } from '@salt/domain/schemas';

  // The timeline band both cook modes wear under the header (issue #994). Its own
  // full-width band, which is why the header above it drops its bottom border — the
  // two read as one block rather than as two stacked bars. Replaces both the
  // "n/m done" line and the "Step x of y" label that used to sit on every step: one
  // segment per step, so position and progress are read at a glance instead of
  // counted. Colours are the app's existing meanings — emerald is its success green
  // (feedback sent, "mild" weather), amber its active/selected marker in the meal
  // planner — rather than the teal primary, which is on almost every other control
  // here and so distinguishes nothing.
  //
  // Each segment also jumps to its step. Small on purpose: the footer and the swipe
  // are the primary ways to move, this is the shortcut. The row is padded well beyond
  // the bar itself so the hit area is bigger than it looks.
  //
  // The same band, the same colours and the same meanings in both modes, because it
  // is the same progress on the same session document — so there is NOTHING here a
  // caller varies. The counts in the aria-label are derived from the two lists rather
  // than passed, which is what stops the two pages from being able to disagree about
  // what "3 of 8 done" means — but derived THROUGH `progressOver`, not by re-rolling
  // the filter, so this band and the footer's Continue/Start label cannot disagree
  // either. Both would be quiet if they did: one is a screen-reader label, the other
  // a button's wording.

  interface Props {
    steps: readonly StepDoc[];
    completedStepIds: ReadonlySet<string>;
    currentStepId: string | null;
    onJump: (stepId: string) => void;
  }
  let { steps, completedStepIds, currentStepId, onJump }: Props = $props();

  const progress = $derived(
    progressOver(
      steps.map((s) => s.id),
      completedStepIds,
    ),
  );
  const totalSteps = $derived(progress.total);
  const completedStepCount = $derived(progress.checked);
</script>

<div
  class="flex shrink-0 items-center gap-1 border-b px-4 py-2"
  role="group"
  aria-label="Steps: {completedStepCount} of {totalSteps} done"
  data-testid="cook-timeline"
>
  {#each steps as timelineStep, index (timelineStep.id)}
    {@const stepDone = completedStepIds.has(timelineStep.id)}
    {@const stepCurrent = currentStepId === timelineStep.id}
    <button
      type="button"
      class="py-2 {stepCurrent
        ? 'flex-[1.6]'
        : 'flex-1'} transition-[flex] duration-200 motion-reduce:transition-none"
      onclick={() => onJump(timelineStep.id)}
      aria-label="Step {index + 1} of {totalSteps}{stepDone ? ', done' : ''}"
      aria-current={stepCurrent ? 'step' : undefined}
      data-testid="cook-timeline-step"
      data-complete={stepDone}
      data-current={stepCurrent}
    >
      <span
        class="block h-1.5 rounded-full transition-colors {stepCurrent
          ? 'bg-amber-500'
          : stepDone
            ? 'bg-emerald-600'
            : 'bg-muted-foreground/25'}"
      ></span>
    </button>
  {/each}
</div>
