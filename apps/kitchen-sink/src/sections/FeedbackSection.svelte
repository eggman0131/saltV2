<script lang="ts">
  import {
    Progress,
    Spinner,
    Icon,
    Toast,
    ToastProvider,
    ToastViewport,
    ToastTitle,
    ToastDescription,
    ToastClose,
    Button,
  } from '@salt/ui-components';

  let progressValue = $state(65);
  let toastOpen = $state(false);
  let toastDestructiveOpen = $state(false);
</script>

<section id="feedback">
  <h2 class="section-title">Feedback</h2>

  <div class="subsection">
    <h3 class="subsection-title">Progress</h3>
    <div class="flex flex-col gap-4 max-w-sm">
      <div>
        <p class="text-sm mb-2">Value: {progressValue}%</p>
        <Progress value={progressValue} max={100} ariaLabel="Loading" />
        <input type="range" min={0} max={100} bind:value={progressValue} class="mt-2 w-full" />
      </div>
      <Progress value={0} max={100} ariaLabel="Empty" />
      <Progress value={100} max={100} ariaLabel="Complete" />
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Spinner</h3>
    <div class="flex items-center gap-6">
      <Spinner size={16} />
      <Spinner size={24} />
      <Spinner size={32} />
      <Spinner size={48} />
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Icon (@lucide/svelte)</h3>
    <div class="flex flex-wrap gap-4">
      {#each ['Bell', 'Check', 'ChevronDown', 'CircleAlert', 'Download', 'Heart', 'Home', 'Info', 'LogOut', 'Mail', 'Menu', 'Plus', 'Search', 'Settings', 'Star', 'Trash', 'User', 'X'] as name}
        <div class="flex flex-col items-center gap-1">
          <Icon name={name as any} size={20} />
          <span class="text-xs text-muted-foreground">{name}</span>
        </div>
      {/each}
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Toast</h3>
    <ToastProvider>
      <div class="flex gap-3">
        <Button variant="outline" onclick={() => (toastOpen = true)}>Show toast</Button>
        <Button variant="destructive" onclick={() => (toastDestructiveOpen = true)}>
          Show error toast
        </Button>
      </div>

      <ToastViewport>
        <Toast bind:open={toastOpen}>
          <ToastTitle>Saved!</ToastTitle>
          <ToastDescription>Your changes have been saved successfully.</ToastDescription>
          <ToastClose />
        </Toast>

        <Toast bind:open={toastDestructiveOpen} variant="destructive">
          <ToastTitle>Error</ToastTitle>
          <ToastDescription>Something went wrong. Please try again.</ToastDescription>
          <ToastClose />
        </Toast>
      </ToastViewport>
    </ToastProvider>
  </div>
</section>
