<script lang="ts">
  import TypographySection from './sections/TypographySection.svelte';
  import LayoutSection from './sections/LayoutSection.svelte';
  import ButtonSection from './sections/ButtonSection.svelte';
  import FormSection from './sections/FormSection.svelte';
  import ComboboxSection from './sections/ComboboxSection.svelte';
  import OverlaySection from './sections/OverlaySection.svelte';
  import FeedbackSection from './sections/FeedbackSection.svelte';

  const nav = [
    { id: 'typography', label: 'Typography' },
    { id: 'layout', label: 'Layout' },
    { id: 'button', label: 'Button' },
    { id: 'form', label: 'Form inputs' },
    { id: 'combobox', label: 'Combobox' },
    { id: 'overlays', label: 'Overlays' },
    { id: 'feedback', label: 'Feedback' },
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
      <TypographySection />
      <LayoutSection />
      <ButtonSection />
      <FormSection />
      <ComboboxSection />
      <OverlaySection />
      <FeedbackSection />
    </main>
  </div>
</div>

<style>
  :global(.section-title) {
    font-family: 'Epilogue', sans-serif;
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid hsl(var(--salt-border));
  }

  :global(.subsection) {
    margin-bottom: 2rem;
  }

  :global(.subsection-title) {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: hsl(var(--salt-muted-foreground));
    margin-bottom: 0.75rem;
  }

  :global(.demo-box) {
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px dashed hsl(var(--salt-border));
    font-size: 0.875rem;
    color: hsl(var(--salt-muted-foreground));
  }
</style>
