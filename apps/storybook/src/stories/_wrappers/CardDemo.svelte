<!-- Composition wrapper for Card.stories.ts. Card is a compound component
     (Card + CardHeader/CardTitle/CardDescription/CardContent/CardFooter) that a
     single `component` + `args` cannot express, so we compose it here and drive
     it with plain props exposed as Storybook controls. Rule 7: only
     @salt/ui-components. -->
<script lang="ts">
  import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
    Button,
  } from '@salt/ui-components';

  let {
    title = 'Weeknight pasta',
    description = 'A quick family favourite',
    content = 'Ready in 20 minutes with pantry staples the whole family will eat.',
    footerText = 'Save recipe',
    withFooter = false,
  }: {
    title?: string;
    description?: string;
    content?: string;
    footerText?: string;
    withFooter?: boolean;
  } = $props();
</script>

<Card class="w-80">
  <CardHeader>
    <CardTitle>{title}</CardTitle>
    <CardDescription>{description}</CardDescription>
  </CardHeader>
  <CardContent>{content}</CardContent>
  {#if withFooter}
    <CardFooter>
      <Button variant="solid" size="sm">{footerText}</Button>
    </CardFooter>
  {/if}
</Card>
