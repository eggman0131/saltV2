<script lang="ts">
  import { Button, Icon, Spinner, Switch } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { recipes, isLoadingRecipes } from '../../lib/recipeService.js';
  import {
    cookSession,
    isLoadingCookSession,
    initCookSessionSync,
    persistCookSession,
    removeCookSession,
    getCookSessionSnapshot,
  } from '../../lib/cookSessionService.js';
  import { auth } from '../../lib/auth.svelte.js';
  import { addToast } from '../../lib/toastStore.js';
  import { isWakeLockSupported, createWakeLock } from '../../lib/wakeLock.js';
  import type { CookSessionDoc, ParsedIngredientDoc, QuantityDoc } from '@salt/domain/schemas';

  // Cook mode (cooking mode, Phase 1). The first FULL-VIEWPORT page in the app: it
  // owns its own `fixed inset-0` container rather than living inside the app shell,
  // because cooking is a heads-down, single-task mode. Stage 1 is mise en place —
  // tick every ingredient off before you start. Ticking is NOT a gate; it's a
  // memory aid that persists to Firestore so it survives a device switch.

  interface Props {
    params: { id: string };
  }
  let { params }: Props = $props();

  // Recipe + identity, derived exactly as RecipeViewPage does.
  const recipe = $derived($recipes.find((r) => r.id === params.id) ?? null);
  const uid = $derived(auth.user?.uid ?? null);
  // Deterministic session id — one session per user per recipe.
  const sessionId = $derived(uid ? `${params.id}_${uid}` : null);

  // ─── Subscription lifecycle ────────────────────────────────────────────────────
  // Re-subscribe whenever the session id changes (uid resolves, or the route param
  // changes). The effect's cleanup disposes the previous subscription.
  let unsub: (() => void) | null = null;
  $effect(() => {
    const sid = sessionId;
    if (!sid) return;
    unsub?.();
    unsub = initCookSessionSync(sid);
    return () => {
      unsub?.();
      unsub = null;
    };
  });

  // ─── Session bootstrap ─────────────────────────────────────────────────────────
  // Once the recipe and the session subscription have both resolved and there is no
  // session yet, create a fresh one stamping the live recipe's `updatedAt` as the
  // baseline. Guarded so it runs once per absent session.
  let bootstrapping = $state(false);

  function makeFreshSession(): CookSessionDoc {
    const now = new Date().toISOString();
    return {
      id: sessionId!,
      schemaVersion: 1,
      ownerUid: uid!,
      recipeId: params.id,
      recipeUpdatedAtAtStart: recipe!.updatedAt,
      checkedIngredientIds: [],
      completedStepIds: [],
      activeTimers: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  async function createFreshSession(): Promise<void> {
    if (!sessionId || !uid || !recipe) return;
    bootstrapping = true;
    const result = await persistCookSession(makeFreshSession());
    bootstrapping = false;
    if (result.kind !== 'ok') addToast('Failed to start cooking.', 'destructive');
  }

  $effect(() => {
    if (!uid || !recipe || !sessionId) return;
    if ($isLoadingCookSession || bootstrapping) return;
    if ($cookSession) return; // already have one
    void createFreshSession();
  });

  // ─── Deleted-recipe orphan handling ────────────────────────────────────────────
  // If the recipe resolves to null AFTER the recipes store has loaded, it was
  // deleted elsewhere. Alert the cook, delete the orphaned session, and bounce to
  // the recipe list. Runs once.
  let orphaned = $state(false);
  $effect(() => {
    if ($isLoadingRecipes) return; // still loading — not an orphan yet
    if (recipe !== null) return;
    if (orphaned) return;
    orphaned = true;
    void handleOrphan();
  });

  async function handleOrphan(): Promise<void> {
    if (sessionId) await removeCookSession(sessionId);
  }

  // ─── Mise-en-place ticking ─────────────────────────────────────────────────────
  const checkedIds = $derived(new Set($cookSession?.checkedIngredientIds ?? []));
  const totalIngredients = $derived(
    recipe ? recipe.ingredients.reduce((n, g) => n + g.items.length, 0) : 0,
  );
  const checkedCount = $derived(
    recipe
      ? recipe.ingredients.reduce(
          (n, g) => n + g.items.filter((i) => checkedIds.has(i.id)).length,
          0,
        )
      : 0,
  );

  function toggleIngredient(id: string): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    const has = s.checkedIngredientIds.includes(id);
    const next = has
      ? s.checkedIngredientIds.filter((x) => x !== id)
      : [...s.checkedIngredientIds, id];
    void persistCookSession({ ...s, checkedIngredientIds: next });
  }

  // Reconstruct a human amount from a metric quantity. Mirrors the recipe view's
  // formatter, plus the mixed-fraction case for count amounts.
  function reconstructQty(q: QuantityDoc): string {
    if (q.type === 'range') return `${q.min}–${q.max}`;
    if (q.type === 'single') return String(q.value);
    // mixed: whole + numerator/denominator
    const frac = q.numerator > 0 ? `${q.numerator}/${q.denominator}` : '';
    if (q.whole > 0 && frac) return `${q.whole} ${frac}`;
    return frac || String(q.whole);
  }

  // Amount fallback ladder (never render "null g"): displayText → reconstruct from
  // quantity+unit → '' (no amount, e.g. "salt to taste"). `parsed` is nullable and
  // handled by the caller (unparsed rows show rawText as their whole label).
  function amountLabel(p: ParsedIngredientDoc): string {
    if (p.displayText) return p.displayText;
    if (p.quantity) {
      const qty = reconstructQty(p.quantity);
      return p.unit ? `${qty}${p.unit}` : qty;
    }
    return '';
  }

  // Primary label for a row: the clean item name when parsed, else the raw line.
  function nameLabel(rawText: string, p: ParsedIngredientDoc | null): string {
    return p?.item.trim() || rawText;
  }

  // ─── Recipe-changed banner ─────────────────────────────────────────────────────
  // The live recipe drifted from the snapshot taken when the session started.
  const recipeChanged = $derived(
    !!recipe && !!$cookSession && recipe.updatedAt !== $cookSession.recipeUpdatedAtAtStart,
  );

  // Restart: discard the current session and start a fresh one against the CURRENT
  // recipe (new baseline, cleared ticks), staying on the cook page so the user
  // keeps cooking the updated recipe.
  let restarting = $state(false);
  async function handleRestart(): Promise<void> {
    if (!sessionId || !uid || !recipe || restarting) return;
    restarting = true;
    await removeCookSession(sessionId);
    const result = await persistCookSession(makeFreshSession());
    restarting = false;
    if (result.kind !== 'ok') {
      addToast('Failed to restart.', 'destructive');
      return;
    }
    addToast('Started fresh with the updated recipe.', 'success');
  }

  // ─── Complete / close ──────────────────────────────────────────────────────────
  // Complete clears the session (delete the doc) and returns to the recipe view.
  let completing = $state(false);
  async function handleComplete(): Promise<void> {
    if (!sessionId || completing) return;
    completing = true;
    await removeCookSession(sessionId);
    completing = false;
    push(`/recipes/${params.id}`);
  }

  // Close leaves the session intact so it can be resumed later / on another device.
  function handleClose(): void {
    push(`/recipes/${params.id}`);
  }

  // ─── Wake lock ──────────────────────────────────────────────────────────────────
  const wakeLockSupported = isWakeLockSupported();
  const wake = wakeLockSupported ? createWakeLock() : null;
  let keepAwake = $state(false);

  function toggleWakeLock(next: boolean): void {
    keepAwake = next;
    if (!wake) return;
    if (next) void wake.enable();
    else void wake.disable();
  }

  // Release the lock when leaving cook mode.
  $effect(() => {
    return () => {
      void wake?.disable();
    };
  });
</script>

<div class="fixed inset-0 z-50 flex h-dvh flex-col bg-background" data-testid="cook-mode-page">
  {#if recipe === null}
    <!-- Loading, or the recipe was deleted (orphan handled by the effect above). -->
    <div class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      {#if $isLoadingRecipes}
        <Spinner size={20} />
        <p class="text-sm text-muted-foreground">Loading…</p>
      {:else}
        <Icon name="TriangleAlert" size={28} class="text-destructive" />
        <div class="flex flex-col gap-1" data-testid="cook-mode-orphan">
          <p class="text-base font-semibold">This recipe was deleted</p>
          <p class="text-sm text-muted-foreground">
            The recipe you were cooking no longer exists, so this cook session has been closed.
          </p>
        </div>
        <Button
          variant="outline"
          onclick={() => push('/recipes')}
          data-testid="cook-mode-orphan-back"
        >
          {#snippet leading()}<Icon name="ArrowLeft" size={16} />{/snippet}
          Back to recipes
        </Button>
      {/if}
    </div>
  {:else}
    <!-- Top bar -->
    <header class="flex shrink-0 items-center gap-3 border-b px-4 py-3">
      <Button
        variant="ghost"
        size="icon"
        onclick={handleClose}
        ariaLabel="Close cook mode"
        title="Close"
        data-testid="cook-mode-close"
      >
        {#snippet leading()}<Icon name="ArrowLeft" size={20} />{/snippet}
      </Button>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-base font-semibold" data-testid="cook-mode-title">
          {recipe.title}
        </span>
        <span class="text-xs text-muted-foreground">
          Mise en place · {checkedCount}/{totalIngredients} ready
        </span>
      </div>
      {#if wakeLockSupported}
        <div data-testid="cook-mode-wakelock">
          <Switch checked={keepAwake} onCheckedChange={toggleWakeLock} label="Keep screen awake" />
        </div>
      {/if}
    </header>

    <!-- Recipe-changed banner -->
    {#if recipeChanged}
      <div
        class="flex shrink-0 items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
        data-testid="cook-mode-recipe-changed"
      >
        <Icon name="TriangleAlert" size={16} class="shrink-0 text-amber-500" />
        <span class="flex-1">This recipe was updated since you started cooking.</span>
        <Button
          size="sm"
          variant="outline"
          onclick={handleRestart}
          loading={restarting}
          disabled={restarting}
          data-testid="cook-mode-restart"
        >
          {#snippet leading()}<Icon name="RefreshCw" size={14} />{/snippet}
          Restart
        </Button>
      </div>
    {/if}

    <!-- Mise-en-place list -->
    <main class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div class="mx-auto flex max-w-2xl flex-col gap-6">
        {#if recipe.ingredients.length === 0}
          <p class="text-sm text-muted-foreground">This recipe has no ingredients.</p>
        {/if}
        {#each recipe.ingredients as group (group.id)}
          <section class="flex flex-col gap-2" data-testid="cook-mise-group">
            {#if group.name}
              <h2
                class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                data-testid="cook-mise-group-name"
              >
                {group.name}
              </h2>
            {/if}
            <ul class="flex flex-col gap-2">
              {#each group.items as ingredient (ingredient.id)}
                {@const checked = checkedIds.has(ingredient.id)}
                {@const amount = ingredient.parsed ? amountLabel(ingredient.parsed) : ''}
                {@const name = nameLabel(ingredient.rawText, ingredient.parsed)}
                {@const prep = (ingredient.parsed?.preparation ?? []).join(', ')}
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 rounded-lg border px-4 py-4 text-left transition-colors active:bg-muted {checked
                      ? 'border-primary/40 bg-primary/5'
                      : 'bg-card hover:bg-muted/50'}"
                    onclick={() => toggleIngredient(ingredient.id)}
                    aria-pressed={checked}
                    data-testid="cook-mise-row"
                  >
                    <span
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border {checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input'}"
                    >
                      {#if checked}<Icon name="Check" size={18} />{/if}
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="text-base {checked ? 'text-muted-foreground line-through' : ''}">
                        {#if amount}<span class="font-semibold">{amount}</span>
                        {/if}{name}{#if ingredient.isOptional}<span
                            class="ml-1 text-xs text-muted-foreground">(optional)</span
                          >{/if}
                      </span>
                      {#if prep}
                        <span class="text-sm text-muted-foreground {checked ? 'line-through' : ''}">
                          {prep}
                        </span>
                      {/if}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </main>

    <!-- Footer -->
    <footer class="flex shrink-0 items-center justify-end gap-3 border-t px-4 py-3">
      <Button
        onclick={handleComplete}
        loading={completing}
        disabled={completing}
        data-testid="cook-mode-complete"
      >
        {#snippet leading()}<Icon name="Check" size={16} />{/snippet}
        Complete
      </Button>
    </footer>
  {/if}
</div>
