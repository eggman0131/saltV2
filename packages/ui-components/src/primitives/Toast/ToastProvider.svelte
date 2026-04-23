<!-- spec: SPEC.md §6 v0.3 -->
<script lang="ts">
  import {
    TOAST_PROVIDER_CONTEXT,
    createToastProviderState,
  } from '../../headless/Toast.headless.svelte';
  import type { ToastProviderProps } from './Toast.types';

  let { children }: ToastProviderProps = $props();

  const state = createToastProviderState({ maxToasts: () => 5 });
  TOAST_PROVIDER_CONTEXT.set(state);
</script>

{@render children?.()}
