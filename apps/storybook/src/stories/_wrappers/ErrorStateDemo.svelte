<!-- ErrorState showcase wrapper for ErrorState.stories.ts. `showRetry` renders
     the built-in retry Button (via onRetry); `customActions` supplies a custom
     `actions` snippet that overrides retry. Optional props are passed only when
     enabled (conditional spread, so no `undefined` is forwarded under
     exactOptionalPropertyTypes). Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { ErrorState, Button } from '@salt/ui-components';

  let {
    title = 'Something went wrong',
    description = '',
    retryLabel = 'Try again',
    showRetry = false,
    customActions = false,
  }: {
    title?: string;
    description?: string;
    retryLabel?: string;
    showRetry?: boolean;
    customActions?: boolean;
  } = $props();

  const handleRetry = () => {};
</script>

{#snippet actionsSnip()}
  <Button variant="outline" size="sm">Retry</Button>
  <Button variant="ghost" size="sm">Go back</Button>
{/snippet}

<ErrorState
  {title}
  {description}
  {retryLabel}
  {...showRetry && !customActions ? { onRetry: handleRetry } : {}}
  {...customActions ? { actions: actionsSnip } : {}}
/>
