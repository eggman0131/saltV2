<script lang="ts">
  import { Button, Card, Icon, Progress } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { formatClock, timerProgress, withTimerDismissed } from '@salt/domain';
  import { currentMember } from '../../lib/membersService.js';
  import {
    liveCooks,
    myTimers,
    needsReviewRecipes,
    timerNowMs,
    type LiveCook,
    type MineTimer,
  } from '../../lib/personalViewService.js';
  import { persistCookSession, removeCookSession } from '../../lib/cookSessionService.js';
  import { addToast } from '../../lib/toastStore.js';

  // "Mine" (issues #634, #682) — what of mine is RUNNING right now, and what needs
  // a look. Three sections, in that order:
  //
  //   1. Timers      — running and fired-but-undismissed, in one list
  //   2. Cooking now — my open cook sessions
  //   3. Needs review — entries nobody has saved yet
  //
  // Nothing here restates the planner or the shopping list; each of those has its
  // own page that says it better. Every card is a projection of a document that
  // exists at this moment: it appears when true and disappears when resolved. No
  // read state, no dismissals, nothing stored per user.

  // ─── Timers ───────────────────────────────────────────────────────────────
  // `endsAt` is absolute, so the countdown is pure arithmetic against a shared
  // clock — the one in personalViewService, which only ticks while a timer of mine
  // exists. Same derivation and the same Cancel → Dismiss flip as cook mode's own
  // timer bar; the two surfaces must never disagree about what a timer is doing.
  const remainingMs = (t: MineTimer, now: number) => Date.parse(t.timer.endsAt) - now;
  const hasFired = (t: MineTimer, now: number) => remainingMs(t, now) <= 0;

  // Cancel and Dismiss are the SAME write: `withTimerDismissed` drops the step's
  // entry unconditionally, so the two labels are one operation seen from either
  // side of `endsAt`. Whole-document LWW, exactly as cook mode persists it.
  async function dismissTimer(t: MineTimer): Promise<void> {
    const result = await persistCookSession(withTimerDismissed(t.session, t.timer.stepId));
    if (result.kind !== 'ok') addToast("Couldn't update that timer.", 'destructive');
  }

  // ─── Cooking now ──────────────────────────────────────────────────────────
  // Cancel abandons the session outright (the doc is deleted — no soft-delete, no
  // tombstones). Consistent with cook mode's own Complete and Restart, which also
  // delete without a confirmation step: an abandoned cook loses tick state, never
  // the recipe.
  let cancellingId = $state<string | null>(null);

  async function cancelCook(cook: LiveCook): Promise<void> {
    if (cancellingId) return;
    cancellingId = cook.session.id;
    const result = await removeCookSession(cook.session.id);
    cancellingId = null;
    if (result.kind !== 'ok') addToast("Couldn't cancel that cook.", 'destructive');
  }

  // ─── Empty state ──────────────────────────────────────────────────────────
  // All three sections are conditional, so the page can be genuinely empty — and
  // that is the usual case. It should read as an achievement, not an absence.
  const allClear = $derived(
    $myTimers.length === 0 && $liveCooks.length === 0 && $needsReviewRecipes.length === 0,
  );
</script>

<section class="flex flex-col gap-4 p-4 sm:p-6" data-testid="mine-page">
  <header class="flex flex-col gap-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">
      {$currentMember ? `${$currentMember.name.split(' ')[0]}'s Salt` : 'Mine'}
    </h1>
    <p class="text-sm text-muted-foreground">What's running, and what needs a look.</p>
  </header>

  <!-- 1. Timers — running and finished together, soonest first. A finished timer
       stays here until it is dismissed; that is the only thing that clears it. -->
  {#if $myTimers.length > 0}
    <div class="flex flex-col gap-2" data-testid="mine-timers">
      <h2 class="text-sm font-medium text-muted-foreground">Timers</h2>
      {#each $myTimers as t (t.id)}
        {@const remaining = remainingMs(t, $timerNowMs)}
        {@const fired = hasFired(t, $timerNowMs)}
        {@const progress = timerProgress(t.timer, t.durationMs, $timerNowMs)}
        <Card class={fired ? 'overflow-hidden border-primary bg-primary/10' : 'overflow-hidden'}>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
            <Icon
              name={fired ? 'BellRing' : 'Timer'}
              size={18}
              class={fired ? 'text-primary' : 'text-muted-foreground'}
            />
            <div class="min-w-0 flex-1">
              <p
                class="truncate text-sm font-medium {fired ? 'text-primary' : 'text-foreground'}"
                data-testid="mine-timer-label"
              >
                {t.label}
              </p>
              <p class="truncate text-xs text-muted-foreground">{t.recipe.title}</p>
            </div>
            <span
              class="shrink-0 font-mono text-base tabular-nums {fired
                ? 'font-semibold text-primary'
                : ''}"
              data-testid="mine-timer-time"
            >
              {fired ? 'Finished' : formatClock(remaining)}
            </span>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant={fired ? 'solid' : 'ghost'}
                onclick={() => dismissTimer(t)}
                data-testid="mine-timer-dismiss"
              >
                {fired ? 'Dismiss' : 'Cancel'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onclick={() => push(`/recipes/${t.recipe.id}/cook`)}
                data-testid="mine-timer-goto"
              >
                Go to recipe
              </Button>
            </div>
          </div>
          <!-- Progress fill, flush to the card's bottom edge. Decorative: the mm:ss
               above already carries the value. -->
          {#if progress !== null}
            <div class="h-1 w-full bg-muted-foreground/15" aria-hidden="true">
              <div
                class="h-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none {fired
                  ? 'bg-primary'
                  : 'bg-amber-500'}"
                style="width: {progress * 100}%"
                data-testid="mine-timer-progress"
              ></div>
            </div>
          {/if}
        </Card>
      {/each}
    </div>
  {/if}

  <!-- 2. Cooking now — all of them: a two-pan dinner is two open cooks, and hiding
       one would misreport the kitchen. Newest first. -->
  {#if $liveCooks.length > 0}
    <div class="flex flex-col gap-2" data-testid="mine-live">
      <h2 class="text-sm font-medium text-muted-foreground">
        Cooking now{$liveCooks.length > 1 ? ` · ${$liveCooks.length} on the go` : ''}
      </h2>
      {#each $liveCooks as cook (cook.session.id)}
        <Card class="border-primary/40 bg-primary/5 p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-base font-semibold text-foreground">
                {cook.recipe.title}
              </p>
              <p class="text-sm text-muted-foreground" data-testid="mine-live-step">
                {cook.stepCount > 0
                  ? `Step ${cook.stepNumber} of ${cook.stepCount}`
                  : 'Mise en place'}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                loading={cancellingId === cook.session.id}
                disabled={cancellingId !== null}
                onclick={() => cancelCook(cook)}
                data-testid="mine-live-cancel"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onclick={() => push(`/recipes/${cook.recipe.id}/cook`)}
                data-testid="mine-live-resume"
              >
                Go to
              </Button>
            </div>
          </div>
          {#if cook.stepCount > 0}
            <Progress
              class="mt-3"
              value={cook.completedCount}
              max={cook.stepCount}
              ariaLabel={`Cook progress: ${cook.recipe.title}`}
            />
          {/if}
        </Card>
      {/each}
    </div>
  {/if}

  <!-- 3. Needs review — everything nobody has saved yet. Standing queue, no time
       limit. The signal is "never saved since it landed", so the copy says exactly
       that, and spells out the clearing action: opening it is not enough. -->
  {#if $needsReviewRecipes.length > 0}
    <div class="flex flex-col gap-2" data-testid="mine-needs-review">
      <h2 class="text-sm font-medium text-muted-foreground">Needs review</h2>
      <p class="text-xs text-muted-foreground" data-testid="mine-needs-review-hint">
        Nobody's checked these yet. Open one, fix anything that's off, and save it to clear it.
      </p>
      {#each $needsReviewRecipes as recipe (recipe.id)}
        <Card class="p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Icon name="Sparkles" size={14} class="text-primary" />
                <span class="truncate">{recipe.title}</span>
              </p>
              <p class="text-xs text-muted-foreground">Not reviewed yet</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              class="shrink-0"
              onclick={() => push(`/recipes/${recipe.id}`)}
              data-testid="mine-needs-review-open"
            >
              Open
            </Button>
          </div>
        </Card>
      {/each}
    </div>
  {/if}

  {#if allClear}
    <Card class="p-4">
      <div class="flex items-center gap-3" data-testid="mine-empty">
        <Icon name="CircleCheck" size={20} class="text-primary" />
        <div>
          <p class="text-sm font-medium text-foreground">You're all caught up</p>
          <p class="text-xs text-muted-foreground">
            No timers, no cook on the go, nothing to review.
          </p>
        </div>
      </div>
    </Card>
  {/if}
</section>
