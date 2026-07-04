<!-- Showcase wrapper for Scales.stories.ts. Reads the radius / elevation / motion /
     z-index token groups from @salt/ui-components/tokens and renders each as a labelled
     row with a visual sample where meaningful (rounded boxes for radius, shadowed
     boxes for elevation, chips for motion/z-index). Radius/elevation values resolve
     against the tokens.css variables loaded by the Storybook preview. Spacing has no
     token export (it is preset-only: xs4/sm8/md16/lg24/xl48), so its rem values are
     listed literally for reference. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { radius, elevation, motion, zIndex } from '@salt/ui-components/tokens';

  const radii: { name: string; value: string }[] = [
    { name: 'sm', value: radius.sm },
    { name: 'DEFAULT', value: radius.DEFAULT },
    { name: 'md', value: radius.md },
    { name: 'lg', value: radius.lg },
    { name: 'xl', value: radius.xl },
    { name: 'full', value: radius.full },
  ];

  const shadows: { name: string; value: string }[] = [
    { name: 'sm', value: elevation.sm },
    { name: 'md', value: elevation.md },
    { name: 'lg', value: elevation.lg },
    { name: 'ambient', value: elevation.ambient },
    { name: 'popover', value: elevation.popover },
    { name: 'dialog', value: elevation.dialog },
  ];

  // Spacing is preset-only (no token export); listed literally for reference.
  const spacing: { name: string; value: string }[] = [
    { name: 'xs · 4px', value: '0.25rem' },
    { name: 'sm · 8px', value: '0.5rem' },
    { name: 'md · 16px', value: '1rem' },
    { name: 'lg · 24px', value: '1.5rem' },
    { name: 'xl · 48px', value: '3rem' },
  ];

  const durations: { name: string; value: string }[] = [
    { name: 'durationFast', value: motion.durationFast },
    { name: 'durationBase', value: motion.durationBase },
    { name: 'durationSlow', value: motion.durationSlow },
  ];

  const easings: { name: string; value: string }[] = [
    { name: 'easeStandard', value: motion.easeStandard },
    { name: 'easeEmphasized', value: motion.easeEmphasized },
    { name: 'easeDecel', value: motion.easeDecel },
  ];

  const zLayers: { name: string; value: number }[] = [
    { name: 'popover', value: zIndex.popover },
    { name: 'dialog', value: zIndex.dialog },
    { name: 'tooltip', value: zIndex.tooltip },
  ];
</script>

<div class="flex flex-col gap-8 p-4">
  <section class="flex flex-col gap-3">
    <h2 class="text-h2">Radius</h2>
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
      {#each radii as r (r.name)}
        <div class="flex flex-col items-center gap-2">
          <div
            class="h-16 w-16 border border-border bg-secondary-container"
            style="border-radius: {r.value}"
          ></div>
          <p class="text-label-caps text-muted-foreground">{r.name}</p>
        </div>
      {/each}
    </div>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="text-h2">Elevation</h2>
    <div class="grid grid-cols-2 gap-6 p-2 sm:grid-cols-3 md:grid-cols-6">
      {#each shadows as s (s.name)}
        <div class="flex flex-col items-center gap-2">
          <div class="h-16 w-16 rounded-lg bg-card" style="box-shadow: {s.value}"></div>
          <p class="text-label-caps text-muted-foreground">{s.name}</p>
        </div>
      {/each}
    </div>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="text-h2">Spacing</h2>
    <div class="flex flex-col gap-3">
      {#each spacing as sp (sp.name)}
        <div class="flex items-center gap-3">
          <div class="h-4 rounded-sm bg-primary" style="width: {sp.value}"></div>
          <p class="text-label-caps text-muted-foreground">{sp.name}</p>
        </div>
      {/each}
    </div>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="text-h2">Motion</h2>
    <div class="flex flex-wrap gap-2">
      {#each durations as d (d.name)}
        <div class="flex items-baseline gap-2 rounded-md border border-border px-3 py-2">
          <span class="text-sm font-medium">{d.name}</span>
          <span class="text-label-caps text-muted-foreground">{d.value}</span>
        </div>
      {/each}
    </div>
    <div class="flex flex-wrap gap-2">
      {#each easings as e (e.name)}
        <div class="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2">
          <span class="text-sm font-medium">{e.name}</span>
          <span class="text-label-caps text-muted-foreground font-mono">{e.value}</span>
        </div>
      {/each}
    </div>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="text-h2">Z-index</h2>
    <div class="flex flex-wrap gap-2">
      {#each zLayers as z (z.name)}
        <div class="flex items-baseline gap-2 rounded-md border border-border px-3 py-2">
          <span class="text-sm font-medium">{z.name}</span>
          <span class="text-label-caps text-muted-foreground">{z.value}</span>
        </div>
      {/each}
    </div>
  </section>
</div>
