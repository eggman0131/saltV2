<!-- Showcase wrapper for Colors.stories.ts. Reads the semantic colour tokens from
     @salt/ui-components/tokens (each is an `hsl(var(--salt-*))` string that resolves
     against the tokens.css variables loaded by the Storybook preview) and renders a
     swatch per role plus a set of foreground-on-background role pairings. Mirrors
     apps/kitchen-sink/src/sections/ColorsSection.svelte. Not a component playground —
     no controls. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { colors } from '@salt/ui-components/tokens';

  const roles: { name: string; value: string }[] = [
    { name: 'background', value: colors.background },
    { name: 'foreground', value: colors.foreground },
    { name: 'primary', value: colors.primary },
    { name: 'primaryForeground', value: colors.primaryForeground },
    { name: 'secondary', value: colors.secondary },
    { name: 'secondaryForeground', value: colors.secondaryForeground },
    { name: 'secondaryContainer', value: colors.secondaryContainer },
    { name: 'secondaryContainerForeground', value: colors.secondaryContainerForeground },
    { name: 'tertiary', value: colors.tertiary },
    { name: 'tertiaryForeground', value: colors.tertiaryForeground },
    { name: 'muted', value: colors.muted },
    { name: 'mutedForeground', value: colors.mutedForeground },
    { name: 'accent', value: colors.accent },
    { name: 'accentForeground', value: colors.accentForeground },
    { name: 'destructive', value: colors.destructive },
    { name: 'destructiveForeground', value: colors.destructiveForeground },
    { name: 'card', value: colors.card },
    { name: 'cardForeground', value: colors.cardForeground },
    { name: 'popover', value: colors.popover },
    { name: 'popoverForeground', value: colors.popoverForeground },
    { name: 'border', value: colors.border },
    { name: 'input', value: colors.input },
    { name: 'ring', value: colors.ring },
  ];

  const pairings: { bg: string; fg: string; label: string }[] = [
    { bg: colors.primary, fg: colors.primaryForeground, label: 'Primary' },
    { bg: colors.secondary, fg: colors.secondaryForeground, label: 'Secondary' },
    {
      bg: colors.secondaryContainer,
      fg: colors.secondaryContainerForeground,
      label: 'Secondary container',
    },
    { bg: colors.accent, fg: colors.accentForeground, label: 'Accent' },
    { bg: colors.muted, fg: colors.mutedForeground, label: 'Muted' },
    { bg: colors.destructive, fg: colors.destructiveForeground, label: 'Destructive' },
    { bg: colors.card, fg: colors.cardForeground, label: 'Card' },
  ];
</script>

<div class="flex flex-col gap-8 p-4">
  <section class="flex flex-col gap-3">
    <h2 class="text-h2">Semantic palette</h2>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {#each roles as role (role.name)}
        <div class="flex flex-col gap-1">
          <div
            class="h-12 rounded-md border border-border"
            style="background-color: {role.value}"
          ></div>
          <p class="text-label-caps text-muted-foreground">{role.name}</p>
        </div>
      {/each}
    </div>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="text-h2">Role pairings</h2>
    <div class="flex flex-col gap-2">
      {#each pairings as p (p.label)}
        <div
          class="flex items-center justify-between rounded-md px-4 py-3"
          style="background-color: {p.bg}; color: {p.fg}"
        >
          <span class="text-sm font-medium">{p.label}</span>
          <span class="text-label-caps">Foreground on background</span>
        </div>
      {/each}
    </div>
  </section>
</div>
