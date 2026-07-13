<script lang="ts">
  import { EmptyState } from '@salt/ui-components';
  import { Button } from '@salt/ui-components';

  // Inline fallback shown by the lazy() route wrapper (routes/index.ts) when a
  // code-split route chunk STILL fails to load after Phase 1 has already spent
  // its single silent auto-reload this session (issue: PWA stale-chunk recovery,
  // Phase 2). Rendering this in place of the hung route loader keeps the rest of
  // the app usable instead of leaving a blank/stuck screen.
  //
  // Retry is a plain full reload. This is LOOP-SAFE: Phase 1's auto-reload is
  // bounded to one per session (guarded in sessionStorage) and only re-arms on a
  // successful boot, so a reload here cannot spin an infinite loop — a broken
  // deploy just lands the user back on this same fallback rather than reloading
  // forever. Mirrors NotFound.svelte's EmptyState + Button visual pattern.
  function retry(): void {
    window.location.reload();
  }
</script>

<div class="p-4 sm:p-6">
  <EmptyState
    title="Couldn't load this page"
    description="Something went wrong loading this page. Please try again."
  >
    {#snippet actions()}
      <Button onclick={retry}>Retry</Button>
    {/snippet}
  </EmptyState>
</div>
