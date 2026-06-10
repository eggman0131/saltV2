<script lang="ts">
  import { Card, CardHeader, CardTitle, CardDescription } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import AdminGuard from './AdminGuard.svelte';

  // Operator home (issues #155, #157). Future cross-domain operator tools
  // (backup, one-off data migrations / repairs) are added here as additional
  // cards/routes.
  const tools = [
    {
      id: 'members',
      title: 'Members',
      description: 'Manage who can sign in and who is an admin.',
      href: '/admin/members',
    },
    {
      id: 'canon',
      title: 'Canon items',
      description: 'Review and curate the shared item catalog and aisles.',
      href: '/admin/canon',
    },
    {
      id: 'mealplan',
      title: 'Meal plan',
      description: 'Edit the standard weekly template and the big-shop day.',
      href: '/admin/mealplan',
    },
  ];
</script>

<AdminGuard>
  <div class="p-4 sm:p-6 flex flex-col gap-4" data-testid="admin-home">
    <div>
      <h1 class="text-xl font-semibold">Admin</h1>
      <p class="text-sm text-muted-foreground">Operator tools for Salt.</p>
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      {#each tools as tool (tool.id)}
        <button
          class="text-left"
          onclick={() => push(tool.href)}
          data-testid="admin-tool-{tool.id}"
        >
          <Card class="h-full transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle>{tool.title}</CardTitle>
              <CardDescription>{tool.description}</CardDescription>
            </CardHeader>
          </Card>
        </button>
      {/each}
    </div>
  </div>
</AdminGuard>
