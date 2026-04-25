<script lang="ts">
  const semanticSwatches = [
    { name: 'Background', var: '--salt-background' },
    { name: 'Foreground', var: '--salt-foreground' },
    { name: 'Primary', var: '--salt-primary' },
    { name: 'Primary foreground', var: '--salt-primary-foreground' },
    { name: 'Secondary', var: '--salt-secondary' },
    { name: 'Secondary foreground', var: '--salt-secondary-foreground' },
    { name: 'Secondary container', var: '--salt-secondary-container' },
    { name: 'Muted', var: '--salt-muted' },
    { name: 'Muted foreground', var: '--salt-muted-foreground' },
    { name: 'Accent', var: '--salt-accent' },
    { name: 'Destructive', var: '--salt-destructive' },
    { name: 'Border', var: '--salt-border' },
    { name: 'Card', var: '--salt-card' },
    { name: 'Popover', var: '--salt-popover' },
    { name: 'Ring', var: '--salt-ring' },
  ];

  const brandSwatches = [
    { name: 'Midnight Navy', hex: '#041920', value: 'hsl(195 77% 7%)' },
    { name: 'Sage Green', hex: '#4f6443', value: 'hsl(98 20% 33%)' },
    { name: 'Sage Container', hex: '#cfe7bd', value: 'hsl(94 47% 82%)' },
    { name: 'Terracotta', hex: '#340500', value: 'hsl(6 100% 10%)' },
    { name: 'Terracotta On', hex: '#e76e50', value: 'hsl(12 76% 61%)' },
    { name: 'Surface', hex: '#f8fafa', value: 'hsl(180 11% 98%)' },
  ];

  const pairings = [
    {
      bg: '--salt-primary',
      fg: '--salt-primary-foreground',
      label: 'Primary on Primary-foreground',
      note: 'Midnight Navy',
    },
    {
      bg: '--salt-secondary',
      fg: '--salt-secondary-foreground',
      label: 'Secondary on Secondary-foreground',
      note: 'Sage Green',
    },
    {
      bg: '--salt-secondary-container',
      fg: '--salt-on-secondary-container',
      label: 'Secondary-container on On-secondary-container',
      note: 'Sage tint',
    },
    {
      bg: '--salt-destructive',
      fg: '--salt-destructive-foreground',
      label: 'Destructive on Destructive-foreground',
      note: 'Error red',
    },
    {
      bg: '--salt-muted',
      fg: '--salt-muted-foreground',
      label: 'Muted on Muted-foreground',
      note: 'Surface container',
    },
  ];
</script>

<section id="colors">
  <h2 class="section-title">Colors</h2>

  <div class="subsection">
    <h3 class="subsection-title">Semantic palette</h3>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
      {#each semanticSwatches as swatch}
        <div class="flex flex-col gap-1">
          <div
            class="h-12 rounded-md border border-border"
            style="background-color: hsl(var({swatch.var}))"
          ></div>
          <p class="text-label-caps text-muted-foreground">{swatch.name}</p>
          <p class="text-xs text-muted-foreground/70 font-mono">{swatch.var}</p>
        </div>
      {/each}
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Brand colors</h3>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
      {#each brandSwatches as swatch}
        <div class="flex flex-col gap-1">
          <div
            class="h-12 rounded-md border border-border"
            style="background-color: {swatch.value}"
          ></div>
          <p class="text-label-caps text-muted-foreground">{swatch.name}</p>
          <p class="text-xs text-muted-foreground/70 font-mono">{swatch.hex}</p>
        </div>
      {/each}
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Role pairings</h3>
    <div class="flex flex-col gap-3">
      {#each pairings as p}
        <div
          class="flex items-center justify-between rounded-md px-4 py-3"
          style="background-color: hsl(var({p.bg})); color: hsl(var({p.fg}))"
        >
          <span class="font-medium text-sm">{p.label}</span>
          <span class="text-label-caps">{p.note}</span>
        </div>
      {/each}
    </div>
  </div>
</section>
