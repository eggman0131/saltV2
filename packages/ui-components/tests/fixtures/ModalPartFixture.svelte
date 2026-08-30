<!-- spec: ui-spec-v02.md §8.6 v0.2.18; ui-spec-v03.md §5.2 v0.3.5 — renders one modal part inside its root -->
<script lang="ts">
  import type { Component } from 'svelte';
  import Dialog from '../../src/primitives/Dialog/Dialog.svelte';
  import DialogContent from '../../src/primitives/Dialog/DialogContent.svelte';
  import Sheet from '../../src/primitives/Sheet/Sheet.svelte';
  import SheetContent from '../../src/primitives/Sheet/SheetContent.svelte';

  let {
    root,
    part: Part,
    class: className = undefined,
    inContent = true,
  }: {
    root: 'dialog' | 'sheet';
    /** The part under test. Deliberately loose: the point is to mount all twelve alike. */
    part: Component<never>;
    class?: string;
    /** Trigger lives beside the content, not inside it. */
    inContent?: boolean;
  } = $props();
</script>

{#snippet subject()}
  {@const P = Part as unknown as Component<{ class?: string; children?: unknown }>}
  <P class={className}>
    {#snippet children()}
      <span data-testid="part-child">child</span>
    {/snippet}
  </P>
{/snippet}

{#if root === 'dialog'}
  <Dialog open={inContent}>
    {#if !inContent}{@render subject()}{/if}
    {#if inContent}
      <DialogContent>{@render subject()}</DialogContent>
    {/if}
  </Dialog>
{:else}
  <Sheet open={inContent}>
    {#if !inContent}{@render subject()}{/if}
    {#if inContent}
      <SheetContent>{@render subject()}</SheetContent>
    {/if}
  </Sheet>
{/if}
