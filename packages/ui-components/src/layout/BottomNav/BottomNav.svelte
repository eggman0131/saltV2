<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { BottomNavProps } from './BottomNav.types';

  let { items, currentPath, class: className }: BottomNavProps = $props();

  function isActive(href: string, path: string): boolean {
    if (href === '/') return path === '/';
    return path === href || path.startsWith(href + '/');
  }
</script>

<nav
  class={cn('fixed inset-x-0 bottom-0 z-10 border-t bg-card lg:hidden', className)}
  aria-label="Main navigation"
>
  <ul class="mx-auto flex h-16 w-full max-w-lg items-center justify-around" role="list">
    {#each items as item (item.id)}
      {@const active = isActive(item.href, currentPath)}
      {@const Icon = item.icon}
      <li class="flex flex-1">
        <a
          href={item.href}
          class={cn(
            'relative flex flex-1 flex-col items-center justify-center gap-1 py-1 text-xs transition-colors',
            active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
          aria-current={active ? 'page' : undefined}
        >
          <Icon size={22} aria-hidden="true" />
          <span>{item.label}</span>
          {#if item.badge}
            <span
              class="absolute right-1/4 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground"
            >
              {item.badge}
            </span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>
</nav>
