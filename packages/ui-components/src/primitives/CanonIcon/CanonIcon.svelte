<!-- spec: canon-icons.md §Rendering v1.0 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { CanonIconProps } from './CanonIcon.types';

  let {
    thumbnail,
    name = '',
    size = 30,
    dimmed = false,
    class: className,
  }: CanonIconProps = $props();

  // Tri-state render boundary. This mirrors @salt/domain's
  // `isCanonIconRenderable`; ui-components cannot import @salt/domain
  // (external-only per the layer map), so the logic is duplicated here as the
  // single render boundary. Keep the two in sync if the `"hidden"` sentinel or
  // the rule changes.
  const renderable = $derived(thumbnail !== null && thumbnail !== 'hidden' && thumbnail.length > 0);
</script>

<span
  class={cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded bg-icon-tile',
    dimmed && 'opacity-40',
    className,
  )}
  style="width: {size}px; height: {size}px;"
  data-testid="canon-icon"
>
  {#if renderable}
    <img
      src={thumbnail}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      class="h-full w-full object-contain"
      data-testid="canon-icon-img"
    />
  {/if}
</span>
