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

  let darkMode = $state(false);

  $effect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  });
</script>

<div class="min-h-screen bg-background text-foreground">
  <!-- Top bar — midnight navy per design spec -->
  <header
    class="sticky top-0 z-40 bg-primary text-primary-foreground px-6 py-3 flex items-center justify-between"
  >
    <span class="font-display font-semibold text-sm tracking-tight">Salt — Kitchen Sink</span>
    <button
      onclick={() => (darkMode = !darkMode)}
      class="text-xs px-3 py-1.5 rounded-md border border-primary-foreground/30 hover:bg-primary-foreground/10 transition-colors"
    >
      {darkMode ? '☀ Light' : '☾ Dark'}
    </button>
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

<style>
  :global(.section-title) {
    @apply text-h2 mb-6 pb-2 border-b border-border;
  }

  :global(.subsection) {
    @apply mb-8;
  }

  :global(.subsection-title) {
    @apply text-label-caps text-muted-foreground mb-3;
  }

  :global(.demo-box) {
    @apply px-3 py-2 rounded-md border border-dashed border-border text-sm text-muted-foreground;
  }
</style>
