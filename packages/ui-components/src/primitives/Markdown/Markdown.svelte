<!-- spec: ai-kitchen-assistant.md §Surfaces v1.0 -->
<script lang="ts">
  import { Markdown as ExMarkdown } from 'svelte-exmarkdown';
  import { gfmPlugin } from 'svelte-exmarkdown/gfm';
  import { cn } from '../../lib/cn';

  let { text, class: className }: { text: string; class?: string } = $props();

  const plugins = [gfmPlugin()];
</script>

<div class={cn('salt-md', className)}>
  <ExMarkdown md={text} {plugins} />
</div>

<style>
  .salt-md :global(:first-child) {
    margin-top: 0;
  }
  .salt-md :global(:last-child) {
    margin-bottom: 0;
  }
  .salt-md :global(p) {
    margin: 0;
  }
  .salt-md :global(p + p) {
    margin-top: 0.5rem;
  }
  .salt-md :global(ul),
  .salt-md :global(ol) {
    margin: 0.25rem 0;
    padding-left: 1.25rem;
  }
  .salt-md :global(ul) {
    list-style: disc;
  }
  .salt-md :global(ol) {
    list-style: decimal;
  }
  .salt-md :global(li) {
    margin: 0.125rem 0;
  }
  .salt-md :global(li > ul),
  .salt-md :global(li > ol) {
    margin: 0.125rem 0;
  }
  .salt-md :global(h1),
  .salt-md :global(h2),
  .salt-md :global(h3),
  .salt-md :global(h4),
  .salt-md :global(h5),
  .salt-md :global(h6) {
    font-weight: 600;
    line-height: 1.3;
    margin: 0.5rem 0 0.25rem;
  }
  .salt-md :global(h1) {
    font-size: 1.125rem;
  }
  .salt-md :global(h2) {
    font-size: 1.0625rem;
  }
  .salt-md :global(h3) {
    font-size: 1rem;
  }
  .salt-md :global(strong) {
    font-weight: 600;
  }
  .salt-md :global(em) {
    font-style: italic;
  }
  .salt-md :global(a) {
    text-decoration: underline;
  }
  .salt-md :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.875em;
    background: rgb(0 0 0 / 0.06);
    padding: 0.0625rem 0.25rem;
    border-radius: 0.25rem;
  }
  .salt-md :global(pre) {
    background: rgb(0 0 0 / 0.06);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    margin: 0.5rem 0;
  }
  .salt-md :global(pre code) {
    background: none;
    padding: 0;
  }
  .salt-md :global(blockquote) {
    border-left: 3px solid currentColor;
    opacity: 0.85;
    padding-left: 0.75rem;
    margin: 0.5rem 0;
  }
  .salt-md :global(hr) {
    border: none;
    border-top: 1px solid currentColor;
    opacity: 0.2;
    margin: 0.5rem 0;
  }
  .salt-md :global(table) {
    border-collapse: collapse;
    margin: 0.5rem 0;
  }
  .salt-md :global(th),
  .salt-md :global(td) {
    border: 1px solid currentColor;
    padding: 0.25rem 0.5rem;
  }
</style>
