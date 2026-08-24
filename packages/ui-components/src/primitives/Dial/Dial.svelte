<!-- spec: ui-spec-v08.md §8.22 v0.8 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { dialVariants } from './Dial.variants';
  import type { DialProps } from './Dial.types';

  let {
    value = 0,
    size = 'md',
    tone = 'neutral',
    children,
    ariaLabel,
    class: className,
  }: DialProps = $props();

  // One viewBox at every size — the rendered diameter is a CSS concern (the size
  // variant), so the geometry below is computed once and never per size.
  const R = 22;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  // Clamped rather than trusted: `value` is a fraction derived from a clock, and
  // a timer that has overrun produces a negative one. A ring is a closed shape
  // with nowhere to put an out-of-range value, so it saturates.
  const fraction = $derived(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)));
  const offset = $derived(CIRCUMFERENCE * (1 - fraction));
</script>

<span class={cn('salt-dial-wrap', className)}>
  <svg
    class={dialVariants({ size, tone })}
    viewBox="0 0 52 52"
    role={ariaLabel === null ? undefined : 'img'}
    aria-label={ariaLabel ?? undefined}
    aria-hidden={ariaLabel === null ? 'true' : undefined}
  >
    <circle class="salt-dial__track" cx="26" cy="26" r={R} fill="none" />
    <!-- Drawn from twelve o'clock: the -90° rotation lives on the sweep alone, so
         the track stays a plain circle and nothing depends on where it started. -->
    <circle
      class="salt-dial__sweep"
      cx="26"
      cy="26"
      r={R}
      fill="none"
      stroke-linecap="round"
      stroke-dasharray={CIRCUMFERENCE}
      stroke-dashoffset={offset}
      transform="rotate(-90 26 26)"
    />
  </svg>
  {#if children}
    <span class="salt-dial__label">{@render children()}</span>
  {/if}
</span>
