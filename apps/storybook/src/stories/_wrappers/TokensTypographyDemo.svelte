<!-- Showcase wrapper for Typography.stories.ts. Renders the named type scale using
     the tailwind-preset component classes (.text-display / .text-h1 / .text-h2 /
     .text-body-lg / .text-body-md / .text-label-caps) and labels each row with its
     size/weight read from the typography tokens. Mirrors
     apps/kitchen-sink/src/sections/TypographySection.svelte. The class strings are
     literal so Tailwind's content scanner emits them. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { typography } from '@salt/ui-components/tokens';

  const scales = [
    {
      cls: 'text-display',
      sample: 'The Art of Cuisine',
      note: `display — Epilogue ${typography.fontSizeDisplay} / ${typography.fontWeightDisplay} / ${typography.letterSpacingDisplay}`,
    },
    {
      cls: 'text-h1',
      sample: 'Seasonal Ingredients',
      note: `h1 — Epilogue ${typography.fontSizeH1} / ${typography.fontWeightHeading} / ${typography.letterSpacingH1}`,
    },
    {
      cls: 'text-h2',
      sample: 'Preparation Methods',
      note: `h2 — Epilogue ${typography.fontSizeH2} / ${typography.fontWeightHeading}`,
    },
    {
      cls: 'text-body-lg',
      sample:
        'Slow-braised with aromatics, deglazed with a dry white wine and reduced to a silky jus.',
      note: `body-lg — Inter ${typography.fontSizeBodyLg} / ${typography.fontWeightBody} / ${typography.lineHeightBodyLg}`,
    },
    {
      cls: 'text-body-md',
      sample: 'Season generously and allow the flavours to develop over low heat before serving.',
      note: `body-md — Inter ${typography.fontSizeBodyMd} / ${typography.fontWeightBody} / ${typography.lineHeightBodyMd}`,
    },
    {
      cls: 'text-label-caps',
      sample: 'Prep 20 min · Cook 2 hours · Serves 4',
      note: `label-caps — Inter ${typography.fontSizeLabelCaps} / ${typography.fontWeightLabelCaps} / ${typography.letterSpacingLabelCaps}`,
    },
  ];
</script>

<div class="flex flex-col divide-y divide-border p-4">
  {#each scales as s (s.cls)}
    <div class="py-6 first:pt-0">
      <p class={s.cls}>{s.sample}</p>
      <p class="text-label-caps text-muted-foreground mt-2">{s.note}</p>
    </div>
  {/each}
</div>
