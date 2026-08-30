<!-- spec: ui-spec-v14.md §8.33 v0.14 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import Icon from '../Icon/Icon.svelte';
  import { popoverMenuItemVariants } from './PopoverMenuItem.variants';
  import type { PopoverMenuItemProps } from './PopoverMenuItem.types';

  let {
    variant = 'default',
    icon,
    iconVisible = true,
    selected = false,
    class: className,
    children,
    ...rest
  }: PopoverMenuItemProps = $props();
</script>

<button
  type="button"
  class={cn(popoverMenuItemVariants({ variant, selected }), className)}
  {...rest}
>
  <!-- `invisible` rather than dropping the element: the unchosen rows of a
       mutually exclusive menu must keep the tick's width, or every label in the
       menu shifts left when the selection moves (§8.33.8). No `ariaLabel` is
       passed, so `Icon` marks itself `aria-hidden` — right in both states here,
       since the label beside it already says what the row is. -->
  {#if icon}
    <Icon name={icon} size={14} class={iconVisible ? '' : 'invisible'} />
  {/if}
  {@render children?.()}
</button>
