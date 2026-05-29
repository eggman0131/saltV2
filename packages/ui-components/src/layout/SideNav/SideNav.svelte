<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { SideNavProps } from './SideNav.types';

  let { items, currentPath, footer, class: className }: SideNavProps = $props();

  function isActive(href: string, path: string): boolean {
    const p = href.startsWith('#') ? href.slice(1) : href;
    if (p === '/') return path === '/';
    return path === p || path.startsWith(p + '/');
  }
</script>

<nav
  class={cn('hidden w-64 shrink-0 flex-col border-r bg-card lg:flex', className)}
  aria-label="Main navigation"
>
  <ul class="flex-1 overflow-y-auto px-2 py-2" role="list">
    {#each items as item (item.id)}
      {@const active = isActive(item.href, currentPath)}
      {@const Icon = item.icon}
      <li>
        <a
          href={item.href}
          class={cn(
            'flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors duration-fast ease-standard',
            active
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
          aria-current={active ? 'page' : undefined}
        >
          <Icon size={18} aria-hidden="true" />
          <span class="flex-1">{item.label}</span>
          {#if item.badge}
            <span
              class="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground"
            >
              {item.badge}
            </span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>

  {#if footer}
    <div class="shrink-0 border-t p-3">
      {@render footer()}
    </div>
  {/if}
</nav>
