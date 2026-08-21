<script lang="ts">
  import { Card, CardHeader, CardTitle, CardDescription } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import AdminGuard from './AdminGuard.svelte';
  import { canonItems } from '../../lib/canonService.js';
  import { productForms } from '../../lib/productFormService.js';

  // Needs-review backlog count — mirrors the badge on the Admin nav entry
  // (App.svelte). Items and product forms are one queue on one tile now that they
  // are one list (issue #872), so the two counts sum exactly as App.svelte's do.
  const needsApprovalCount = $derived($canonItems.filter((i) => i.needs_approval).length);
  const pendingFormCount = $derived($productForms.filter((f) => f.needs_approval).length);
  const tileBadge = $derived<Record<string, number>>({
    catalog: needsApprovalCount + pendingFormCount,
  });

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
      id: 'catalog',
      title: 'Catalog',
      description:
        'Review and curate the shared items, and the product forms that stand in for them.',
      href: '/admin/catalog',
    },
    {
      id: 'aisles',
      title: 'Aisles',
      description: 'Organise and sort the store aisles items are grouped into.',
      href: '/admin/aisles',
    },
    {
      id: 'mealplan',
      title: 'Meal plan',
      description: 'Edit the standard weekly template and the big-shop day.',
      href: '/admin/mealplan',
    },
    {
      id: 'dev-settings',
      title: 'Development settings',
      description: 'Per-environment operator switches, e.g. canon icon generation.',
      href: '/admin/dev-settings',
    },
    {
      id: 'app-settings',
      title: 'Application settings',
      description:
        'Home location, weather, and the AI model used for each role in this environment.',
      href: '/admin/app-settings',
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
              <CardTitle class="flex items-center gap-2">
                <span>{tool.title}</span>
                {#if (tileBadge[tool.id] ?? 0) > 0}
                  <span
                    class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs leading-none text-primary-foreground"
                    data-testid="admin-tool-{tool.id}-badge"
                  >
                    {tileBadge[tool.id]}
                  </span>
                {/if}
              </CardTitle>
              <CardDescription>{tool.description}</CardDescription>
            </CardHeader>
          </Card>
        </button>
      {/each}
    </div>
  </div>
</AdminGuard>
