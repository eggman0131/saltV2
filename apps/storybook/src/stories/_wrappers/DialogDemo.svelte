<!-- Composition wrapper for Dialog.stories.ts. Dialog is a compound overlay
     (root + DialogTrigger + DialogContent > Header/Title/Description/Footer/Close)
     wired through context, so a single `component` + `args` cannot express it.
     `open` is a controlled prop exposed as a Storybook control: toggling it opens
     the modal (the trigger stays visible for the closed state). `portal={false}`
     renders the content inline in the canvas instead of teleporting to <body> —
     cleaner for isolation + the eventual Chromatic snapshot. Rule 7: only
     @salt/ui-components. -->
<script lang="ts">
  import {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
    Button,
  } from '@salt/ui-components';

  let {
    open = false,
    size = 'md',
  }: {
    open?: boolean;
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  } = $props();
</script>

<Dialog {open} portal={false}>
  <DialogTrigger>
    <Button variant="outline">Edit household</Button>
  </DialogTrigger>
  <DialogContent {size}>
    <DialogHeader>
      <DialogTitle>Edit household</DialogTitle>
      <DialogDescription>
        Update the shared details. Dismiss with Escape or the close button.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose>
        <Button variant="outline">Cancel</Button>
      </DialogClose>
      <Button variant="solid">Save changes</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
