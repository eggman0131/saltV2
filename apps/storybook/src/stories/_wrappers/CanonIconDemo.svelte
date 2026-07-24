<!-- CanonIcon showcase wrapper for CanonIcon.stories.ts. `showSizes=false`
     renders a single tile (thumbnail/name/size/dimmed stay live controls);
     `showSizes=true` renders the same thumbnail across the app's tile sizes.
     Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { CanonIcon } from '@salt/ui-components';

  let {
    thumbnail = null,
    name = 'Tinned tomatoes',
    size = 48,
    dimmed = false,
    matched = false,
    shimmer = false,
    showSizes = false,
  }: {
    thumbnail?: string | null;
    name?: string;
    size?: number;
    dimmed?: boolean;
    matched?: boolean;
    shimmer?: boolean;
    showSizes?: boolean;
  } = $props();

  const sizes = [20, 30, 48, 64];
</script>

{#if showSizes}
  <div class="flex items-end gap-4">
    {#each sizes as s (s)}
      <div class="flex flex-col items-center gap-1.5">
        <CanonIcon {thumbnail} {name} size={s} {dimmed} {matched} {shimmer} />
        <span class="text-xs text-muted-foreground">{s}px</span>
      </div>
    {/each}
  </div>
{:else}
  <CanonIcon {thumbnail} {name} {size} {dimmed} {matched} {shimmer} />
{/if}
