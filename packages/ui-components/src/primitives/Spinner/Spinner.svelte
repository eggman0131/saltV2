<!-- spec: SPEC.md §8.14 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';

  let {
    size = 16,
    ariaLabel = 'Loading',
    class: className,
  }: { size?: number; ariaLabel?: string; class?: string } = $props();
</script>

<span role="status" aria-label={ariaLabel} class={cn('inline-flex', className)}>
  <svg
    aria-hidden="true"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="animate-spin motion-reduce:animate-none"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
</span>
