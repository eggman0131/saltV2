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
  import type {
    CookSessionDoc,
    IngredientDoc,
    ParsedIngredientDoc,
    QuantityDoc,
  } from '@salt/domain/schemas';

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

  // ─── Guided steps (Phase 2) ─────────────────────────────────────────────────────
  // Two stages share this page's header/banner/footer shell; only the scroll region
  // swaps. `mise` is Stage 1 (tick ingredients); `steps` is this phase — one
  // full-viewport guided step at a time on a vertical snap-scroll. Default is mise.
  let stage = $state<'mise' | 'steps'>('mise');

  // One-shot resume: when the session first resolves already carrying step progress,
  // open straight into steps so reopening a half-cooked recipe drops you back where
  // you were (land-on-first-incomplete below finds the exact step). A plain-boolean
  // guard (not $state) keeps this from re-firing as the session updates.
  let stageInitialised = false;
  $effect(() => {
    if (stageInitialised) return;
    const s = $cookSession;
    if (!s) return;
    stageInitialised = true;
    if (s.completedStepIds.length > 0) stage = 'steps';
  });

  const completedStepIds = $derived(new Set($cookSession?.completedStepIds ?? []));
  const totalSteps = $derived(recipe?.steps.length ?? 0);
  const completedStepCount = $derived(
    recipe ? recipe.steps.filter((s) => completedStepIds.has(s.id)).length : 0,
  );

  // First-use ingredients per step. The recipe stamps `firstUsedInStepId` on each
  // ingredient at the step it's first needed, so a step can surface exactly the
  // items it introduces (amount + prep) inline — no scrolling back to mise mid-cook.
  const firstUseByStep = $derived.by(() => {
    const map = new Map<string, IngredientDoc[]>();
    if (!recipe) return map;
    for (const group of recipe.ingredients) {
      for (const item of group.items) {
        const sid = item.firstUsedInStepId;
        if (!sid) continue;
        const list = map.get(sid);
        if (list) list.push(item);
        else map.set(sid, [item]);
      }
    }
    return map;
  });

  // Toggle a step's completion — mirrors `toggleIngredient`, whole-document LWW via
  // the service (there is no field-level write). Completion is never a gate: tapping
  // a done step un-completes it, and earlier steps are never force re-ticked.
  function toggleStep(id: string): void {
    const s = getCookSessionSnapshot();
    if (!s) return;
    const has = s.completedStepIds.includes(id);
    const next = has ? s.completedStepIds.filter((x) => x !== id) : [...s.completedStepIds, id];
    void persistCookSession({ ...s, completedStepIds: next });
  }

  // Land-on-first-incomplete. Fires only when the stage flips to `steps`; it reads
  // completion from a NON-reactive snapshot so ticking a step done does NOT yank the
  // scroll onward — the cook swipes at their own pace. Completed steps stay above,
  // collapsed but scrollable back and re-openable. Degrades to a plain scroll (or
  // top-of-list) if the anchor or scrollIntoView isn't available.
  let stepsScroller = $state<HTMLElement | null>(null);
  const stepEls = new Map<string, HTMLElement>();
  function stepAnchor(node: HTMLElement, id: string) {
    stepEls.set(id, node);
    return {
      destroy() {
        if (stepEls.get(id) === node) stepEls.delete(id);
      },
    };
  }

  $effect(() => {
    if (stage !== 'steps') return;
    if (!stepsScroller) return;
    const snap = getCookSessionSnapshot();
    const done = new Set(snap?.completedStepIds ?? []);
    const steps = recipe?.steps ?? [];
    const target = steps.find((s) => !done.has(s.id)) ?? steps[steps.length - 1];
    if (!target) return;
    const el = stepEls.get(target.id);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => el?.scrollIntoView?.({ block: 'start', behavior: 'auto' }));
    } else {
      el?.scrollIntoView?.({ block: 'start' });
    }
  });

  function goToSteps(): void {
    stage = 'steps';
  }
  function goToMise(): void {
    stage = 'mise';
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
          {#if stage === 'mise'}
            Mise en place · {checkedCount}/{totalIngredients} ready
          {:else}
            Guided steps · {completedStepCount}/{totalSteps} done
          {/if}
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

    <!-- Stage 1: mise-en-place list / Stage 2: guided steps -->
    {#if stage === 'mise'}
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
                        <span
                          class="text-base {checked ? 'text-muted-foreground line-through' : ''}"
                        >
                          {#if amount}<span class="font-semibold">{amount}</span>
                          {/if}{name}{#if ingredient.isOptional}<span
                              class="ml-1 text-xs text-muted-foreground">(optional)</span
                            >{/if}
                        </span>
                        {#if prep}
                          <span
                            class="text-sm text-muted-foreground {checked ? 'line-through' : ''}"
                          >
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
    {:else}
      <!-- Guided steps: one full-viewport step per screen on a vertical snap-scroll.
         Completed steps collapse to a compact row (tap to re-open); the first
         incomplete step fills the screen and shows its first-use ingredients inline.
         Degrades to a plain scrollable list where snap/animation is unavailable. -->
      <main
        bind:this={stepsScroller}
        class="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto"
        data-testid="cook-steps-view"
      >
        {#if recipe.steps.length === 0}
          <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p class="text-base font-semibold">This recipe has no steps</p>
            <p class="text-sm text-muted-foreground">
              There's nothing to guide through — tap Complete when you're done.
            </p>
          </div>
        {/if}
        {#each recipe.steps as step, i (step.id)}
          {@const done = completedStepIds.has(step.id)}
          {@const firstUse = firstUseByStep.get(step.id) ?? []}
          {@const nextStep = recipe.steps[i + 1] ?? null}
          <section
            use:stepAnchor={step.id}
            data-step-id={step.id}
            data-complete={done}
            data-testid="cook-step"
            class="flex snap-start flex-col px-4 transition-[min-height] duration-300 motion-reduce:transition-none {done
              ? 'min-h-0 py-2'
              : 'min-h-full py-6'}"
          >
            {#if done}
              <!-- Collapsed / done: compact row, tap to re-open (un-complete). -->
              <button
                type="button"
                class="mx-auto flex w-full max-w-2xl items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-left"
                onclick={() => toggleStep(step.id)}
                aria-pressed="true"
                data-testid="cook-step-complete"
              >
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary bg-primary text-primary-foreground"
                >
                  <Icon name="Check" size={18} />
                </span>
                <span
                  class="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Step {i + 1}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">
                  {step.text}
                </span>
              </button>
            {:else}
              <!-- Active / incomplete: fills the screen, arm's-length type. -->
              <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6">
                <span class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Step {i + 1} of {recipe.steps.length}
                </span>

                {#if firstUse.length > 0}
                  <ul
                    class="flex flex-col gap-1 rounded-lg border bg-card px-4 py-3"
                    data-testid="cook-step-firstuse"
                  >
                    {#each firstUse as ing (ing.id)}
                      {@const amount = ing.parsed ? amountLabel(ing.parsed) : ''}
                      {@const name = nameLabel(ing.rawText, ing.parsed)}
                      {@const prep = (ing.parsed?.preparation ?? []).join(', ')}
                      <li class="text-base">
                        {#if amount}<span class="font-semibold">{amount}</span>
                        {/if}{name}{#if ing.isOptional}<span
                            class="ml-1 text-xs text-muted-foreground">(optional)</span
                          >{/if}{#if prep}<span class="text-muted-foreground">, {prep}</span>{/if}
                      </li>
                    {/each}
                  </ul>
                {/if}

                <p class="text-2xl leading-relaxed sm:text-3xl">{step.text}</p>
                {#if step.note}
                  <p class="text-lg text-muted-foreground">{step.note}</p>
                {/if}

                <!-- Phase 3 note: the per-step timer control slots in here (step.timer is
                   intentionally NOT rendered in Phase 2). -->

                <div>
                  <Button
                    size="lg"
                    onclick={() => toggleStep(step.id)}
                    data-testid="cook-step-complete"
                  >
                    {#snippet leading()}<Icon name="Check" size={18} />{/snippet}
                    Mark step done
                  </Button>
                </div>
              </div>

              {#if nextStep}
                <div
                  class="mx-auto mt-4 w-full max-w-2xl border-t pt-3"
                  data-testid="cook-step-next"
                >
                  <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Next
                  </span>
                  <p class="line-clamp-1 text-sm text-muted-foreground">{nextStep.text}</p>
                </div>
              {/if}
            {/if}
          </section>
        {/each}
      </main>
    {/if}

    <!-- Footer -->
    <footer class="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
      {#if stage === 'mise'}
        <Button
          variant="ghost"
          onclick={handleComplete}
          loading={completing}
          disabled={completing}
          data-testid="cook-mode-complete"
        >
          {#snippet leading()}<Icon name="Check" size={16} />{/snippet}
          Complete
        </Button>
        <Button onclick={goToSteps} data-testid="cook-stage-toggle">
          Start cooking
          {#snippet trailing()}<Icon name="ArrowRight" size={16} />{/snippet}
        </Button>
      {:else}
        <Button variant="ghost" onclick={goToMise} data-testid="cook-stage-back">
          {#snippet leading()}<Icon name="ArrowLeft" size={16} />{/snippet}
          Mise en place
        </Button>
        <Button
          onclick={handleComplete}
          loading={completing}
          disabled={completing}
          data-testid="cook-mode-complete"
        >
          {#snippet leading()}<Icon name="Check" size={16} />{/snippet}
          Complete
        </Button>
      {/if}
    </footer>
  {/if}
</div>
