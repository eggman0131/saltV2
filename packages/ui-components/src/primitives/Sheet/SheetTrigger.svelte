<!-- spec: ui-spec-v03.md §5.3.1 v0.3.2 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { SheetPartProps } from './Sheet.types';

  let { class: className, children }: SheetPartProps = $props();
</script>

<Dialog.Trigger class={className}>
  {@render children?.()}
</Dialog.Trigger>
