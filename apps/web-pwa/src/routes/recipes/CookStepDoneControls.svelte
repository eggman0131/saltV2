<script lang="ts">
  import { Button, Icon } from '@salt/ui-components';

  // The ONLY control that unticks a step, in either cook mode (issue #994).
  // Reachable solely from a deliberate peek, so re-reading can't undo your progress.

  interface Props {
    onUntick: () => void;
    onCollapse: () => void;
  }
  let { onUntick, onCollapse }: Props = $props();
</script>

<div class="flex items-center gap-2">
  <Button variant="ghost" size="sm" onclick={onUntick} data-testid="cook-step-untick">
    {#snippet leading()}<Icon name="Undo2" size={16} />{/snippet}
    Mark not done
  </Button>
  <Button variant="ghost" size="sm" onclick={onCollapse} data-testid="cook-step-collapse">
    {#snippet leading()}<Icon name="ChevronUp" size={16} />{/snippet}
    Collapse
  </Button>
</div>
