<!-- spec: SPEC.md §8.15 v0.2.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Progress } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { createProgressState } from '../../headless/Progress.headless.svelte';
  import { progressRootVariants, progressIndicatorVariants } from './Progress.variants';
  import type { ProgressProps } from './Progress.types';

  let {
    value = $bindable(),
    defaultValue = undefined,
    max = 100,
    announce = 'polite',
    ariaLabel,
    class: className,
  }: ProgressProps = $props();

  if (value === undefined) value = untrack(() => defaultValue);

  const state = createProgressState({
    value: () => value,
    max: () => max,
  });
</script>

<Progress.Root
  value={state.bitsValue}
  {max}
  class={cn(progressRootVariants(), className)}
  aria-label={ariaLabel}
  aria-live={announce === 'polite' ? 'polite' : undefined}
>
  <div
    class={progressIndicatorVariants({ indeterminate: state.isIndeterminate })}
    style={state.isIndeterminate ? undefined : `transform: translateX(-${100 - state.percent}%)`}
  ></div>
</Progress.Root>
