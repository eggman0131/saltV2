<!-- Composition wrapper for Toast.stories.ts. Toast REQUIRES a ToastProvider
     ancestor (it throws a context error without one) and renders inside a
     ToastViewport. `open` is held static and `duration={0}` disables the
     auto-dismiss timer so the toast stays visible for the snapshot. The viewport
     is `fixed bottom-0 right-0`, so the toast anchors to the bottom-right of the
     canvas. NOTE: the ToastClose (X) button is `opacity-0` until the toast is
     hovered (group-hover) by design. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import {
    ToastProvider,
    ToastViewport,
    Toast,
    ToastTitle,
    ToastDescription,
    ToastClose,
    ToastAction,
  } from '@salt/ui-components';

  let {
    variant = 'default',
    withAction = false,
  }: {
    variant?: 'default' | 'destructive' | 'success';
    withAction?: boolean;
  } = $props();
</script>

<ToastProvider>
  <ToastViewport>
    <Toast open duration={0} {variant}>
      <div class="grid gap-1">
        <ToastTitle>Item added</ToastTitle>
        <ToastDescription>Tinned tomatoes are on the shopping list.</ToastDescription>
      </div>
      {#if withAction}
        <ToastAction>Undo</ToastAction>
      {/if}
      <ToastClose />
    </Toast>
  </ToastViewport>
</ToastProvider>
