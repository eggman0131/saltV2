<script lang="ts">
  // Placeholder shown by svelte-spa-router's `wrap({ loadingComponent })` while a
  // lazily-imported route chunk is fetched (issue #411). Deliberately dependency-
  // free — a pure CSS spinner, no icon import — so it stays in the boot chunk and
  // never itself triggers a network fetch at the moment a route is loading.
</script>

<div
  class="flex h-full min-h-64 w-full items-center justify-center"
  role="status"
  aria-label="Loading"
>
  <div
    class="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
  ></div>
</div>
