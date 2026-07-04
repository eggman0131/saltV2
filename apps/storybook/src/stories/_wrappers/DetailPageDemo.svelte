<!-- Composition wrapper for DetailPage.stories.ts. DetailPage takes optional
     `actions`/`metadata` Snippet slots and an `onBack` handler that change its
     layout (metadata switches to a two-column grid). Under exactOptionalPropertyTypes
     we must not forward `undefined`, so the `actions`/`metadata` snippets are declared
     at the top level and passed via conditional spread ({...(cond ? { p } : {})}),
     and `onBack` the same way. The body is the default children snippet. Rule 7:
     only @salt/ui-components. -->
<script lang="ts">
  import {
    DetailPage,
    Button,
    Card,
    CardHeader,
    CardTitle,
    CardContent,
  } from '@salt/ui-components';

  let {
    title = 'Weeknight pasta',
    subtitle = 'Dinner · 20 minutes · Serves 4',
    withActions = false,
    withMetadata = false,
    withBack = false,
  }: {
    title?: string;
    subtitle?: string;
    withActions?: boolean;
    withMetadata?: boolean;
    withBack?: boolean;
  } = $props();

  const noop = () => {};
</script>

<div class="w-full max-w-3xl">
  <DetailPage
    {title}
    {subtitle}
    {...withBack ? { onBack: noop } : {}}
    {...withActions ? { actions } : {}}
    {...withMetadata ? { metadata } : {}}
  >
    <p class="text-body-md leading-relaxed text-muted-foreground">
      Slow-braised with aromatics, deglazed with a dry white wine and reduced to a silky jus. Rest
      for five minutes before serving.
    </p>
  </DetailPage>
</div>

{#snippet actions()}
  <Button variant="outline" size="sm">Edit</Button>
  <Button variant="solid" size="sm">Cook</Button>
{/snippet}

{#snippet metadata()}
  <Card>
    <CardHeader>
      <CardTitle>Details</CardTitle>
    </CardHeader>
    <CardContent>
      <dl class="flex flex-col gap-2 text-sm">
        <div class="flex justify-between">
          <dt class="text-muted-foreground">Prep</dt>
          <dd>10 min</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-muted-foreground">Cook</dt>
          <dd>20 min</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-muted-foreground">Serves</dt>
          <dd>4</dd>
        </div>
      </dl>
    </CardContent>
  </Card>
{/snippet}
