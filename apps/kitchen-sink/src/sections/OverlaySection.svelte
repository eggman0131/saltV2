<script lang="ts">
  import {
    Button,
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
    Sheet,
    SheetTrigger,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
    SheetClose,
    Popover,
    PopoverTrigger,
    PopoverContent,
    Tooltip,
    TooltipProvider,
    TooltipTrigger,
    TooltipContent,
  } from '@salt/ui-components';

  let sheetSide: 'left' | 'right' | 'top' | 'bottom' = $state('right');
</script>

<section id="overlays">
  <h2 class="section-title">Overlays</h2>

  <div class="subsection">
    <h3 class="subsection-title">Dialog</h3>
    <div class="flex flex-wrap gap-3">
      {#each ['sm', 'md', 'lg'] as size}
        <Dialog>
          <DialogTrigger>
            {#snippet children()}
              <Button variant="outline">Open {size}</Button>
            {/snippet}
          </DialogTrigger>
          <DialogContent size={size as 'sm' | 'md' | 'lg'}>
            <DialogHeader>
              <DialogTitle>Dialog — {size}</DialogTitle>
              <DialogDescription>
                This is a {size}-sized dialog. Dismiss with Escape or the close button.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose>
                {#snippet children()}
                  <Button variant="outline">Cancel</Button>
                {/snippet}
              </DialogClose>
              <Button>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      {/each}
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Sheet</h3>
    <div class="flex flex-wrap gap-3">
      {#each ['left', 'right', 'top', 'bottom'] as side}
        <Sheet side={side as 'left' | 'right' | 'top' | 'bottom'}>
          <SheetTrigger>
            {#snippet children()}
              <Button variant="outline">{side}</Button>
            {/snippet}
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Sheet — {side}</SheetTitle>
              <SheetDescription>Slides in from the {side}.</SheetDescription>
            </SheetHeader>
            <div class="py-4">Content goes here.</div>
            <SheetFooter>
              <SheetClose>
                {#snippet children()}
                  <Button variant="outline">Close</Button>
                {/snippet}
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      {/each}
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Popover</h3>
    <Popover>
      <PopoverTrigger>
        {#snippet children()}
          <Button variant="outline">Open popover</Button>
        {/snippet}
      </PopoverTrigger>
      <PopoverContent class="p-4 w-56">
        <p class="text-sm">Popover content. Can hold any interactive elements.</p>
      </PopoverContent>
    </Popover>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Tooltip</h3>
    <TooltipProvider>
      <div class="flex gap-4">
        {#each ['top', 'right', 'bottom', 'left'] as side}
          <Tooltip>
            <TooltipTrigger>
              {#snippet children()}
                <Button variant="outline" size="sm">{side}</Button>
              {/snippet}
            </TooltipTrigger>
            <TooltipContent side={side as 'top' | 'right' | 'bottom' | 'left'}>
              {#snippet children()}
                Tooltip on the {side}
              {/snippet}
            </TooltipContent>
          </Tooltip>
        {/each}
      </div>
    </TooltipProvider>
  </div>
</section>
