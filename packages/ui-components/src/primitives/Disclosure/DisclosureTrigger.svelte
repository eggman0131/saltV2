<!-- spec: ui-spec-v09.md §8.26 v0.9 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { DisclosureTriggerProps } from './Disclosure.types';

  let { expanded, class: className, children, ...rest }: DisclosureTriggerProps = $props();
</script>

<button type="button" class={cn(className)} aria-expanded={expanded} {...rest}>
  {@render children?.()}
</button>
