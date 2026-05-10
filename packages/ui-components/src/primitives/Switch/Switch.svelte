<!-- spec: SPEC.md §8.5 v0.2.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Switch } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { createSwitchState } from '../../headless/Switch.headless.svelte';
  import { switchRootVariants, switchThumbVariants } from './Switch.variants';
  import type { SwitchProps } from './Switch.types';

  let {
    checked = $bindable(),
    defaultChecked = false,
    disabled = false,
    required = false,
    name,
    value = 'on',
    label,
    description,
    error,
    size = 'md',
    class: className,
    onCheckedChange,
  }: SwitchProps = $props();

  if (checked === undefined) checked = untrack(() => defaultChecked);

  const fieldState = createSwitchState({
    id: () => undefined,
    error: () => error,
    description: () => description,
  });

  function handleCheckedChange(next: boolean) {
    checked = next;
    onCheckedChange?.(next);
  }
</script>

<div class={cn('flex items-center gap-2', className)}>
  <Switch.Root
    id={fieldState.id}
    checked={checked ?? false}
    onCheckedChange={handleCheckedChange}
    {disabled}
    {required}
    {value}
    {...(name !== undefined ? { name } : {})}
    aria-describedby={fieldState.describedBy}
    class={switchRootVariants({ size })}
  >
    <Switch.Thumb class={switchThumbVariants({ size })} />
  </Switch.Root>

  <div class="flex flex-col gap-0.5">
    <label for={fieldState.id} class="text-sm font-medium text-foreground">
      {label}
    </label>

    {#if description}
      <span id={fieldState.descId} class="text-sm text-muted-foreground">{description}</span>
    {/if}

    {#if error}
      <span id={fieldState.errorId} role="alert" class="text-sm text-destructive">{error}</span>
    {/if}
  </div>
</div>
