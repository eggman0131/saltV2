<!-- spec: SPEC.md §6 v0.3 — test fixture for Toast composition -->
<script lang="ts">
  import ToastProvider from '../../src/primitives/Toast/ToastProvider.svelte';
  import ToastViewport from '../../src/primitives/Toast/ToastViewport.svelte';
  import Toast from '../../src/primitives/Toast/Toast.svelte';
  import ToastTitle from '../../src/primitives/Toast/ToastTitle.svelte';
  import ToastDescription from '../../src/primitives/Toast/ToastDescription.svelte';
  import ToastAction from '../../src/primitives/Toast/ToastAction.svelte';
  import ToastClose from '../../src/primitives/Toast/ToastClose.svelte';

  let {
    open = $bindable<boolean>(),
    defaultOpen = false,
    duration = 5000,
    variant = 'default' as 'default' | 'destructive',
    title = 'Toast title',
    description = undefined as string | undefined,
    showAction = false,
    showClose = false,
    onOpenChange,
  }: {
    open?: boolean;
    defaultOpen?: boolean;
    duration?: number;
    variant?: 'default' | 'destructive';
    title?: string;
    description?: string;
    showAction?: boolean;
    showClose?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = $props();
</script>

<ToastProvider>
  <ToastViewport>
    <Toast bind:open {defaultOpen} {duration} {variant} {onOpenChange}>
      <ToastTitle>{title}</ToastTitle>
      {#if description}
        <ToastDescription>{description}</ToastDescription>
      {/if}
      {#if showAction}
        <ToastAction>Undo</ToastAction>
      {/if}
      {#if showClose}
        <ToastClose />
      {/if}
    </Toast>
  </ToastViewport>
</ToastProvider>
