<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Spinner } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { normaliseMemberEmail } from '@salt/domain';
  import { auth } from '../../lib/auth.svelte.js';
  import { members, isLoadingMembers } from '../../lib/membersService.js';

  let { children }: { children: Snippet } = $props();

  // Reactive admin check from the live roster + the signed-in user. This guard
  // is a UX convenience only — it hides operator screens from non-admins. The
  // real enforcement is server-side: Firestore rules gate member writes on the
  // caller's admin flag, and operator Cloud Functions must re-check admin
  // themselves (issue #155).
  const currentEmail = $derived(normaliseMemberEmail(auth.user?.email ?? ''));
  const currentMember = $derived($members.find((m) => m.email === currentEmail) ?? null);
  const isAdmin = $derived(currentMember?.admin === true);

  // Wait until the roster has loaded before judging admin-ness, otherwise we'd
  // bounce a legitimate admin on first paint before the subscription delivers.
  const settled = $derived(!$isLoadingMembers);

  $effect(() => {
    if (settled && !isAdmin) {
      push('/');
    }
  });
</script>

{#if !settled}
  <div class="flex items-center justify-center py-12" data-testid="admin-guard-loading">
    <Spinner size={24} />
  </div>
{:else if isAdmin}
  {@render children()}
{:else}
  <div class="p-6 text-sm text-muted-foreground" data-testid="admin-guard-denied">
    You don't have access to this area.
  </div>
{/if}
