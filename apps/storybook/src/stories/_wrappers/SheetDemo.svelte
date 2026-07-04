<!-- Composition wrapper for Sheet.stories.ts. Sheet is a compound overlay
     (root + SheetTrigger + SheetContent > Header/Title/Description/Footer/Close)
     that slides in from a `side`. Same force-open pattern as DialogDemo: a
     controlled `open` control + `portal={false}` for inline rendering. Rule 7:
     only @salt/ui-components. -->
<script lang="ts">
  import {
    Sheet,
    SheetTrigger,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
    SheetClose,
    Button,
  } from '@salt/ui-components';

  let {
    open = false,
    side = 'right',
  }: {
    open?: boolean;
    side?: 'left' | 'right' | 'top' | 'bottom';
  } = $props();
</script>

<Sheet {open} {side} portal={false}>
  <SheetTrigger>
    <Button variant="outline">Open filters</Button>
  </SheetTrigger>
  <SheetContent>
    <SheetHeader>
      <SheetTitle>Filters</SheetTitle>
      <SheetDescription>Slides in from the {side}.</SheetDescription>
    </SheetHeader>
    <div class="py-4 text-sm text-muted-foreground">Refine the recipe list here.</div>
    <SheetFooter>
      <SheetClose>
        <Button variant="outline">Close</Button>
      </SheetClose>
      <Button variant="solid">Apply</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
