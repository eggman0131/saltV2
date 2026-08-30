<!-- Composition wrapper for PopoverMenuItem.stories.ts. A menu row only reads as
     itself inside the menu it belongs to, so the story shows the whole popover:
     the four shapes #930 collapsed into one component, in the order a real menu
     puts them. Same force-open pattern as PopoverDemo — a controlled `open` and
     `portal={false}` so the floating content renders inline in the canvas.
     Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import {
    Popover,
    PopoverTrigger,
    PopoverContent,
    PopoverMenuItem,
    Button,
  } from '@salt/ui-components';

  let {
    open = true,
    busy = false,
    chosen = 'aisle',
  }: { open?: boolean; busy?: boolean; chosen?: 'aisle' | 'recipe' } = $props();
</script>

<Popover {open} portal={false}>
  <PopoverTrigger>
    <Button variant="outline">Open menu</Button>
  </PopoverTrigger>
  <PopoverContent align="end" class="min-w-52 p-1">
    <!-- The tick column: `iconVisible` rather than `{#if}`, so the unchosen row
         keeps the tick's width and both labels stay aligned (§8.33.8). -->
    <PopoverMenuItem icon="Check" iconVisible={chosen === 'aisle'}>Aisle</PopoverMenuItem>
    <PopoverMenuItem icon="Check" iconVisible={chosen === 'recipe'}>Recipe</PopoverMenuItem>
    <div class="my-1 h-px bg-border"></div>
    <PopoverMenuItem icon="Pencil">Edit</PopoverMenuItem>
    <PopoverMenuItem icon="Sparkles" disabled={busy}>Make a variation</PopoverMenuItem>
    <PopoverMenuItem selected>Groceries</PopoverMenuItem>
    <PopoverMenuItem variant="destructive" icon="Trash2">Delete</PopoverMenuItem>
  </PopoverContent>
</Popover>
