<script lang="ts">
  import ColorsSection from './sections/ColorsSection.svelte';
  import TypographySection from './sections/TypographySection.svelte';
  import LayoutSection from './sections/LayoutSection.svelte';
  import ButtonSection from './sections/ButtonSection.svelte';
  import FormSection from './sections/FormSection.svelte';
  import ComboboxSection from './sections/ComboboxSection.svelte';
  import OverlaySection from './sections/OverlaySection.svelte';
  import FeedbackSection from './sections/FeedbackSection.svelte';
  import TemplatesSection from './sections/TemplatesSection.svelte';

  const nav = [
    { id: 'colors', label: 'Colors' },
    { id: 'typography', label: 'Typography' },
    { id: 'layout', label: 'Layout' },
    { id: 'button', label: 'Button' },
    { id: 'form', label: 'Form inputs' },
    { id: 'combobox', label: 'Combobox' },
    { id: 'overlays', label: 'Overlays' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'templates', label: 'Templates' },
  ];

  // NOTE: no dark-mode toggle. The production app (@salt/web-pwa) is light-only —
  // it never applies the `.dark` class at runtime — so a working toggle here would
  // mislead into QA-ing / building `dark:` variants that production never renders.
  // The dormant `.dark` token overrides in app.css are kept only because
  // ui-components' Tooltip renders on an inverted surface. See README.md.
</script>

<div class="min-h-screen bg-background text-foreground">
  <!-- Top bar — midnight navy per design spec -->
  <header class="sticky top-0 z-40 bg-primary text-primary-foreground px-6 py-3 flex items-center">
    <span class="font-display font-semibold text-sm tracking-tight">Salt — Kitchen Sink</span>
  </header>

  <div class="flex">
    <!-- Sidebar nav -->
    <nav
      class="sticky top-[49px] h-[calc(100vh-49px)] w-48 shrink-0 overflow-y-auto border-r border-border bg-card p-4 hidden md:block"
    >
      <ul class="flex flex-col gap-1">
        {#each nav as item}
          <li>
            <a
              href="#{item.id}"
              class="block rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <!-- Content -->
    <main class="flex-1 min-w-0 px-6 md:px-10 py-8 space-y-16">
      <ColorsSection />
      <TypographySection />
      <LayoutSection />
      <ButtonSection />
      <FormSection />
      <ComboboxSection />
      <OverlaySection />
      <FeedbackSection />
      <TemplatesSection />
    </main>
  </div>
</div>
