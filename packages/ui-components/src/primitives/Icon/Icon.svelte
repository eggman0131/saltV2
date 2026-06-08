<!-- spec: SPEC.md §8.12 v0.2.3 -->
<script lang="ts">
  import { icons } from '@lucide/svelte';
  import { cn } from '../../lib/cn';
  import type { IconProps } from './Icon.types';

  let { name, size = 16, ariaLabel, class: className }: IconProps = $props();

  // Uppercase binding so Svelte treats it as a component (Svelte 5 runes mode)
  let IconComponent = $derived(icons[name] as any);
</script>

<IconComponent
  {size}
  class={cn('shrink-0', className)}
  aria-hidden={ariaLabel ? undefined : 'true'}
  role={ariaLabel ? 'img' : undefined}
  aria-label={ariaLabel}
/>
