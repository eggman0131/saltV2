<!-- EmptyState showcase wrapper for EmptyState.stories.ts. The `icon`/`actions`
     snippets must render live components (Icon, Button), which createRawSnippet
     can't do. Booleans toggle each variant; the snippet props are passed only
     when enabled (conditional spread, so no `undefined` is forwarded under
     exactOptionalPropertyTypes). Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { EmptyState, Icon, Button } from '@salt/ui-components';

  let {
    title = 'No recipes yet',
    description = '',
    showIcon = false,
    showActions = false,
  }: {
    title?: string;
    description?: string;
    showIcon?: boolean;
    showActions?: boolean;
  } = $props();
</script>

{#snippet iconSnip()}
  <Icon name="BookOpen" size={32} />
{/snippet}

{#snippet actionsSnip()}
  <Button variant="solid" size="sm">Add recipe</Button>
  <Button variant="outline" size="sm">Import</Button>
{/snippet}

<EmptyState
  {title}
  {description}
  {...showIcon ? { icon: iconSnip } : {}}
  {...showActions ? { actions: actionsSnip } : {}}
/>
