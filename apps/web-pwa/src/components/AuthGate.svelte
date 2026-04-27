<script lang="ts">
  import type { Snippet } from 'svelte';
  import { auth } from '../lib/auth.svelte.js';
  import LoginPage from './LoginPage.svelte';

  let { children }: { children: Snippet } = $props();
</script>

{#if auth.loading}
  <main class="min-h-screen flex items-center justify-center text-foreground bg-background">
    <p class="text-sm text-muted-foreground">Signing you in…</p>
  </main>
{:else if !auth.user}
  <LoginPage />
{:else}
  {@render children()}
{/if}
