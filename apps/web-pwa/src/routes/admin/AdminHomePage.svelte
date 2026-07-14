<script lang="ts">
  import { Card, CardHeader, CardTitle, CardDescription } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import AdminGuard from './AdminGuard.svelte';
  import { canonItems } from '../../lib/canonService.js';
  import { productForms } from '../../lib/productFormService.js';

  // Needs-review backlog counts — mirror the badge on the Admin nav entry
  // (App.svelte) so the same numbers surface per tool tile. Canon and product
  // forms each track their own pending queue.
  const needsApprovalCount = $derived($canonItems.filter((i) => i.needs_approval).length);
  const pendingFormCount = $derived($productForms.filter((f) => f.needs_approval).length);
  const tileBadge = $derived<Record<string, number>>({
    canon: needsApprovalCount,
    'product-forms': pendingFormCount,
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
      id: 'canon',
      title: 'Canon items',
      description: 'Review and curate the shared item catalog.',
      href: '/admin/canon',
    },
    {
      id: 'aisles',
      title: 'Aisles',
      description: 'Organise and sort the store aisles items are grouped into.',
      href: '/admin/aisles',
    },
    {
      id: 'product-forms',
      title: 'Product forms',
      description: 'Map alternate ingredient forms to a parent item and its yield.',
      href: '/admin/product-forms',
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
