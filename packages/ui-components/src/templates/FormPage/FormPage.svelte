<!-- spec: SPEC.md §9.2 v0.2.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import Button from '../../primitives/Button/Button.svelte';
  import type { FormPageProps } from './FormPage.types';

  let {
    title,
    description,
    submitLabel = 'Save',
    cancelLabel = 'Cancel',
    isSubmitting = false,
    canSubmit = true,
    onSubmit,
    onCancel,
    footer,
    children,
    class: className,
  }: FormPageProps = $props();

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    onSubmit?.(event);
  }
</script>

<form class={cn('flex flex-col gap-6', className)} onsubmit={handleSubmit} novalidate>
  <header class="flex flex-col gap-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
    {#if description}
      <p class="text-sm text-muted-foreground">{description}</p>
    {/if}
  </header>

  <div class="flex flex-col gap-4">
    {@render children?.()}
  </div>

  <footer class="flex items-center justify-end gap-2 pt-4 border-t border-border">
    {#if footer}
      {@render footer()}
    {:else}
      {#if onCancel}
        <Button variant="ghost" type="button" onclick={onCancel} disabled={isSubmitting}>
          {cancelLabel}
        </Button>
      {/if}
      <Button type="submit" loading={isSubmitting} disabled={!canSubmit}>
        {submitLabel}
      </Button>
    {/if}
  </footer>
</form>
