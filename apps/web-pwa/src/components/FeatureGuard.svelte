<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Spinner } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { featureGate, type FeatureGate, type FeatureKey } from '../lib/featureGate.js';

  let { feature, children }: { feature: FeatureKey; children: Snippet } = $props();

  // Route-level gate for an unfinished feature (issue #831). Same shape as
  // AdminGuard — wait for the answer, then either render the page or leave — with
  // one deliberate difference: the refused branch renders NOTHING. AdminGuard says
  // "you don't have access to this area" because the operator area is a known place
  // you are simply not allowed into; a gated feature is one nobody outside the test
  // group is supposed to know exists, so a denial message would announce it.
  //
  // COSMETIC ONLY. See featureGate.ts — the boundary is not here and is not needed.

  let gate = $state<FeatureGate>({ enabled: false, settled: false });
  // subscribe() returns its own unsubscribe, which is exactly what $effect wants
  // as a cleanup — so the flag subscription dies with the page.
  $effect(() => featureGate(feature).subscribe((v) => (gate = v)));

  // Wait for the payload before bouncing, or the flagged user is thrown off their
  // own page a beat before PostHog says they may have it.
  $effect(() => {
    if (gate.settled && !gate.enabled) {
      push('/');
    }
  });
</script>

{#if !gate.settled}
  <div class="flex items-center justify-center py-12" data-testid="feature-guard-loading">
    <Spinner size={24} />
  </div>
{:else if gate.enabled}
  {@render children()}
{/if}
