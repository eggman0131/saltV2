<script lang="ts">
  import {
    Button,
    Card,
    Icon,
    Progress,
    RadioGroup,
    RadioGroupItem,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Switch,
  } from '@salt/ui-components';
  import type { IconName } from '@salt/ui-components';
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import {
    appendCacheBuster,
    formatClock,
    timerProgress,
    withTimerDismissed,
    type Recipe,
  } from '@salt/domain';
  import { kitchenLabel } from '../../lib/membersService.js';
  import {
    liveCooks,
    myTimers,
    needsReviewRecipes,
    recentChats,
    timerNowMs,
    upcomingChefNights,
    type LiveCook,
    type MineTimer,
    type UpcomingChefNight,
  } from '../../lib/personalViewService.js';
  import { subscribeKitchenWeeks } from '../../lib/mealPlanService.js';
  import { persistCookSession, removeCookSession } from '../../lib/cookSessionService.js';
  import { persistRecipe, recipes } from '../../lib/recipeService.js';
  import { addToast } from '../../lib/toastStore.js';
  import {
    kitchenPrefs,
    type KitchenDensity,
    type KitchenSection,
  } from '../../lib/kitchenDashboardPrefs.svelte.js';

  // "My Kitchen" (issues #634, #682, #755) — what of mine is running right now,
  // what is coming at me, and what needs a look. Five sections, in that order:
  //
  //   1. Timers       — running and fired-but-undismissed, in one list
  //   2. Cooking now  — my open cook sessions
  //   3. Cooking soon — the nights from today onward that I am chef on
  //   4. Needs review — entries flagged `needs_approval`
  //   5. Recent chats — a quiet footer, the only thing here not waiting on you
  //
  // Cooking soon is the one section that reads plan data, and it is not a
  // restatement of the planner: which nights are YOURS is a run of days forward
  // from today that does not stop at the end of a cycle, and the planner renders
  // weeks. Nothing here restates the shopping list. Every card is a projection of
  // a document that exists at this moment: it appears when true and disappears
  // when resolved. No read state, no dismissals, nothing stored per user.
  //
  // This is still that same page — the "workbench" below (imagery, a glance
  // strip, and the Customize sheet) is presentation, not new content: it never
  // reads a document the five sections above don't already read. Toggling a
  // section off just hides it; it does not change what counts as all-clear.

  // Cooking soon needs one or two meal-plan week documents, which nothing else
  // holds on this page's behalf. Page-owned for the reason the planner's own
  // extension week is: a live subscription kept alive for a screen nobody is
  // looking at is the failure mode. The teardown only drops this page's CLAIM —
  // the planner may be holding the same week (see `pruneWeekSubscriptions`).
  onMount(() => subscribeKitchenWeeks());

  // ─── Workbench: imagery, density, which sections show ───────────────────────
  // In-memory only (kitchenDashboardPrefs.svelte.ts) — CLAUDE.md Rule 3 forbids
  // persisting this to browser storage, so it resets to "everything on,
  // comfortable" on reload. That is an accepted tradeoff for a page that is
  // opened often and briefly, not configured once and left.
  let customizeOpen = $state(false);

  const SECTION_TOGGLES: ReadonlyArray<{
    key: KitchenSection;
    label: string;
    description: string;
  }> = [
    { key: 'timers', label: 'Timers', description: 'Running and finished cook timers.' },
    { key: 'live', label: 'Cooking now', description: 'Cooks you have open right now.' },
    { key: 'upcoming', label: 'Cooking soon', description: 'Nights from today you are chef on.' },
    { key: 'review', label: 'Needs review', description: "AI imports nobody's read yet." },
    { key: 'chats', label: 'Recent chats', description: 'A shortcut back into a conversation.' },
  ];

  function onDensityChange(value: string): void {
    kitchenPrefs.setDensity(value as KitchenDensity);
  }

  const outerGap = $derived(kitchenPrefs.density === 'compact' ? 'gap-3' : 'gap-4');
  const listGap = $derived(kitchenPrefs.density === 'compact' ? 'gap-1.5' : 'gap-2');
  const cardPad = $derived(kitchenPrefs.density === 'compact' ? 'p-3' : 'p-4');
  const thumbSize = $derived(kitchenPrefs.density === 'compact' ? 'h-10 w-10' : 'h-12 w-12');

  // A recipe's own hero, cache-busted the same way the recipe list and detail
  // pages do (issue #460) — never denormalised, so a card renders whatever the
  // recipe carries right now. `undefined` covers a night with nothing attached.
  function recipeThumb(recipe: Recipe | undefined): string | null {
    if (!recipe?.image?.url) return null;
    return appendCacheBuster(recipe.image.url, recipe.imageRequestedAt ?? recipe.updatedAt);
  }

  // ─── A personalised, time-of-day header ──────────────────────────────────────
  // The greeting is a new line ABOVE the heading, never a replacement for it:
  // issue #828 ties the page's h1 to the same `kitchenLabel` the header link
  // reads, so the two can never say a different name for the same kitchen.
  function timeOfDayGreeting(hour: number): string {
    if (hour < 5) return 'Up late';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    if (hour < 21) return 'Good evening';
    return 'Winding down';
  }
  const greeting = timeOfDayGreeting(new Date().getHours());

  // ─── Cooking soon ─────────────────────────────────────────────────────────
  // "Tonight" and "Tomorrow" are worth naming; past that a weekday reads faster
  // than a countdown. Formatted in UTC because a date key is a calendar day, not
  // an instant — parsing it as local midnight would shift it a day west of GMT.
  const NIGHT_FORMAT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  function nightLabel(night: UpcomingChefNight): string {
    if (night.daysAway === 0) return 'Tonight';
    if (night.daysAway === 1) return 'Tomorrow';
    return NIGHT_FORMAT.format(new Date(`${night.date}T00:00:00.000Z`));
  }

  // What is planned, in the order the day carries it — attached entries first,
  // then the note. A night that is yours but blank still shows: that IS the
  // useful signal, so it says so rather than being hidden.
  function nightMeal(night: UpcomingChefNight): string {
    if (night.recipes.length > 0) return night.recipes.map((r) => r.title).join(' · ');
    if (night.day.note.trim()) return night.day.note.trim();
    return 'Nothing planned yet';
  }

  // The recipe when there is one, otherwise that day in the planner — which is
  // where a note lives and the only place it can be changed.
  function openNight(night: UpcomingChefNight): void {
    const first = night.recipes[0];
    push(first ? `/recipes/${first.id}` : `/mealplan/${night.date}`);
  }

  // ─── Timers ───────────────────────────────────────────────────────────────
  // `endsAt` is absolute, so the countdown is pure arithmetic against a shared
  // clock — the one in personalViewService, which only ticks while a timer of mine
  // exists. Same derivation and the same Cancel → Dismiss flip as cook mode's own
  // timer bar; the two surfaces must never disagree about what a timer is doing.
  const remainingMs = (t: MineTimer, now: number) => Date.parse(t.timer.endsAt) - now;
  const hasFired = (t: MineTimer, now: number) => remainingMs(t, now) <= 0;

  // Cancel and Dismiss are the SAME write: `withTimerDismissed` drops the timer's
  // entry unconditionally, so the two labels are one operation seen from either
  // side of `endsAt`. Whole-document LWW, exactly as cook mode persists it.
  async function dismissTimer(t: MineTimer): Promise<void> {
    const result = await persistCookSession(withTimerDismissed(t.session, t.timer.id));
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

  // ─── Needs review ─────────────────────────────────────────────────────────
  // The same clear the recipe page's banner performs (issue #755), brought to the
  // row so a queue of clean imports can be emptied without opening any of them.
  // One id, exactly like `cancellingId`: it names the row that is mid-write so its
  // spinner lands in the right place, and it holds the rest still meanwhile.
  let reviewingId = $state<string | null>(null);

  async function markReviewed(recipe: Recipe): Promise<void> {
    if (reviewingId) return;
    // Re-read the LIVE document, never the row we rendered from: `persistRecipe`
    // writes the whole doc, so saving a stale copy would roll back whatever the
    // onRecipeWritten trigger wrote alongside us (`image`, `imageBrief`).
    const current = $recipes.find((r) => r.id === recipe.id);
    if (!current) return;
    reviewingId = recipe.id;
    // Dropped, not set false — absent means reviewed, matching the schema and the
    // full-document setDoc persistRecipe performs.
    const { needs_approval: _wasUnreviewed, ...reviewed } = current;
    const persisted = await persistRecipe(reviewed);
    reviewingId = null;
    if (persisted.kind !== 'ok') addToast("Couldn't mark that as reviewed.", 'destructive');
  }

  // ─── Empty state ──────────────────────────────────────────────────────────
  // Every section is conditional, so the page can be genuinely empty — and that is
  // the usual case. It should read as an achievement, not an absence.
  //
  // Recent chats is deliberately NOT in this sum: a kitchen with nothing but old
  // conversations in it is still all-clear, and hiding "You're all caught up"
  // behind a chat you had last Tuesday would make a shortcut look like a chore.
  //
  // Driven from the underlying stores, never from the workbench toggles: hiding
  // a section you don't want to see must not paint a false "all caught up" over
  // work that is still there.
  const allClear = $derived(
    $myTimers.length === 0 &&
      $liveCooks.length === 0 &&
      $upcomingChefNights.length === 0 &&
      $needsReviewRecipes.length === 0,
  );

  // ─── Glance strip ─────────────────────────────────────────────────────────
  // A quick-read summary of the same four sections below — never a restatement
  // of anything outside this page. Only counts that are (a) switched on in the
  // workbench and (b) actually non-zero get a tile, so it stays a glance, not a
  // second copy of the empty state.
  interface StatTile {
    readonly key: KitchenSection;
    readonly icon: IconName;
    readonly count: number;
    readonly label: string;
  }
  const statTiles = $derived(
    (
      [
        { key: 'timers', icon: 'Timer', count: $myTimers.length, noun: 'timer' },
        { key: 'live', icon: 'CookingPot', count: $liveCooks.length, noun: 'cooking' },
        { key: 'upcoming', icon: 'CalendarDays', count: $upcomingChefNights.length, noun: 'ahead' },
        { key: 'review', icon: 'Sparkles', count: $needsReviewRecipes.length, noun: 'to review' },
      ] as const
    )
      .filter((t) => kitchenPrefs.sections[t.key] && t.count > 0)
      .map((t): StatTile => ({
        key: t.key,
        icon: t.icon,
        count: t.count,
        label:
          t.noun === 'cooking' || t.noun === 'to review'
            ? `${t.count} ${t.noun}`
            : `${t.count} ${t.noun}${t.count === 1 ? '' : 's'}`,
      })),
  );
</script>

<section class="flex flex-col {outerGap} p-4 sm:p-6" data-testid="mine-page">
  <header
    class="flex flex-col gap-3 rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-4"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex flex-col gap-1">
        <p class="text-xs font-medium uppercase tracking-wide text-primary">{greeting}</p>
        <h1 class="text-xl font-semibold tracking-tight text-foreground">
          {$kitchenLabel}
        </h1>
        <p class="text-sm text-muted-foreground">
          {allClear
            ? "Nothing waiting on you — you're all caught up."
            : "What's running, and what needs a look."}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        ariaLabel="Customize this page"
        title="Customize"
        onclick={() => (customizeOpen = true)}
        data-testid="mine-customize-open"
      >
        <Icon name="SlidersHorizontal" size={18} />
      </Button>
    </div>

    {#if statTiles.length > 0}
      <div class="flex flex-wrap gap-2" data-testid="mine-stats">
        {#each statTiles as tile (tile.key)}
          <div
            class="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-xs font-medium text-primary"
          >
            <Icon name={tile.icon} size={13} />
            <span>{tile.label}</span>
          </div>
        {/each}
      </div>
    {/if}
  </header>

  <!-- 1. Timers — running and finished together, soonest first. A finished timer
       stays here until it is dismissed; that is the only thing that clears it. -->
  {#if kitchenPrefs.sections.timers && $myTimers.length > 0}
    <div class="flex flex-col {listGap}" data-testid="mine-timers">
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
  {#if kitchenPrefs.sections.live && $liveCooks.length > 0}
    <div class="flex flex-col {listGap}" data-testid="mine-live">
      <h2 class="text-sm font-medium text-muted-foreground">
        Cooking now{$liveCooks.length > 1 ? ` · ${$liveCooks.length} on the go` : ''}
      </h2>
      {#each $liveCooks as cook (cook.session.id)}
        <Card class="border-primary/40 bg-primary/5 {cardPad}">
          <div class="flex items-center gap-3">
            {#if kitchenPrefs.imagery}
              {@const thumb = recipeThumb(cook.recipe)}
              <div class="relative {thumbSize} shrink-0 overflow-hidden rounded-md bg-muted">
                {#if thumb}
                  <img
                    src={thumb}
                    alt=""
                    loading="lazy"
                    class="h-full w-full object-cover"
                    data-testid="mine-live-thumb"
                  />
                {:else}
                  <div
                    class="flex h-full w-full items-center justify-center text-muted-foreground/60"
                  >
                    <Icon name="CookingPot" size={18} />
                  </div>
                {/if}
              </div>
            {/if}
            <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
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

  <!-- 3. Cooking soon — the nights from here on that are mine. One or two week
       documents behind it (this week, plus next week's once the cycle is nearly
       out), so the boundary is invisible: it is one run of nights, not a week. -->
  {#if kitchenPrefs.sections.upcoming && $upcomingChefNights.length > 0}
    <div class="flex flex-col {listGap}" data-testid="mine-upcoming">
      <h2 class="text-sm font-medium text-muted-foreground">Cooking soon</h2>
      {#each $upcomingChefNights as night (night.date)}
        {@const thumb = kitchenPrefs.imagery ? recipeThumb(night.recipes[0]) : null}
        <Card class="overflow-hidden">
          <button
            type="button"
            class="flex w-full items-center gap-3 p-3 text-left"
            onclick={() => openNight(night)}
            data-testid="mine-upcoming-open"
          >
            {#if thumb}
              <div class="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                <img
                  src={thumb}
                  alt=""
                  loading="lazy"
                  class="h-full w-full object-cover"
                  data-testid="mine-upcoming-thumb"
                />
              </div>
            {:else}
              <Icon name="CalendarDays" size={18} class="shrink-0 text-muted-foreground" />
            {/if}
            <div class="min-w-0 flex-1">
              <p
                class="truncate text-sm font-medium text-foreground"
                data-testid="mine-upcoming-when"
              >
                {nightLabel(night)}
              </p>
              <p class="truncate text-xs text-muted-foreground" data-testid="mine-upcoming-meal">
                {nightMeal(night)}
              </p>
            </div>
            <Icon name="ChevronRight" size={16} class="shrink-0 text-muted-foreground" />
          </button>
        </Card>
      {/each}
    </div>
  {/if}

  <!-- 4. Needs review — imported by AI, not read by a human yet. Standing queue,
       no time limit. Both actions clear it: opening one to fix something and
       saving, or marking it reviewed here when it came through clean. -->
  {#if kitchenPrefs.sections.review && $needsReviewRecipes.length > 0}
    <div class="flex flex-col {listGap}" data-testid="mine-needs-review">
      <h2 class="text-sm font-medium text-muted-foreground">Needs review</h2>
      <p class="text-xs text-muted-foreground" data-testid="mine-needs-review-hint">
        These were written by AI and nobody's read them yet. Open one to fix anything that's off, or
        mark it reviewed if it looks right.
      </p>
      {#each $needsReviewRecipes as recipe (recipe.id)}
        <Card class={cardPad}>
          <div class="flex items-start gap-3">
            {#if kitchenPrefs.imagery}
              {@const thumb = recipeThumb(recipe)}
              <div class="{thumbSize} shrink-0 overflow-hidden rounded-md bg-muted">
                {#if thumb}
                  <img
                    src={thumb}
                    alt=""
                    loading="lazy"
                    class="h-full w-full object-cover"
                    data-testid="mine-needs-review-thumb"
                  />
                {:else}
                  <div class="flex h-full w-full items-center justify-center text-primary/60">
                    <Icon name="Sparkles" size={18} />
                  </div>
                {/if}
              </div>
            {/if}
            <div class="flex min-w-0 flex-1 items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Icon name="Sparkles" size={14} class="text-primary" />
                  <span class="truncate">{recipe.title}</span>
                </p>
                <p class="text-xs text-muted-foreground">Not reviewed yet</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={reviewingId === recipe.id}
                  disabled={reviewingId !== null}
                  onclick={() => markReviewed(recipe)}
                  data-testid="mine-needs-review-clear"
                >
                  Mark reviewed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onclick={() => push(`/recipes/${recipe.id}`)}
                  data-testid="mine-needs-review-open"
                >
                  Open
                </Button>
              </div>
            </div>
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
            No timers, no cook on the go, no nights of yours coming up, nothing to review.
          </p>
        </div>
      </div>
    </Card>
  {/if}

  <!-- 5. Recent chats — last, after the empty state, because it is a shortcut back
       into a conversation rather than something waiting on you. Read-only: the
       subscription is already running app-wide, and a chat is deleted or expires
       from its own page, never from here. Titles are a raw slice of the first
       message until the chef retitles them, so the row has to survive an ugly one:
       truncated on one line, and the row itself is the target. -->
  {#if kitchenPrefs.sections.chats && $recentChats.length > 0}
    <div class="flex flex-col {listGap}" data-testid="mine-chats">
      <h2 class="text-sm font-medium text-muted-foreground">Recent chats</h2>
      {#each $recentChats as chat (chat.id)}
        <Card class="overflow-hidden">
          <button
            type="button"
            class="flex w-full items-center gap-3 p-3 text-left"
            onclick={() => push(`/chat/${chat.id}`)}
            data-testid="mine-chat-open"
          >
            <Icon name="ChefHat" size={18} class="shrink-0 text-muted-foreground" />
            <span
              class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              data-testid="mine-chat-title"
            >
              {chat.title}
            </span>
            <Icon name="ChevronRight" size={16} class="shrink-0 text-muted-foreground" />
          </button>
        </Card>
      {/each}
    </div>
  {/if}
</section>

<!-- The workbench: tune which sections show, how dense they render, and whether
     recipe imagery draws. Bottom sheet, matching every other on-page settings
     surface in this app (WeekShopSheet, CookTimerSheet, …). Nothing here is
     wired to a Firestore write — see kitchenDashboardPrefs.svelte.ts. -->
<Sheet bind:open={customizeOpen} side="bottom">
  <SheetContent class="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-4 pb-8">
    <SheetHeader>
      <SheetTitle>Customize your kitchen</SheetTitle>
    </SheetHeader>

    <div class="flex flex-col gap-3">
      <h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sections</h3>
      {#each SECTION_TOGGLES as toggle (toggle.key)}
        <div data-testid={`mine-customize-section-${toggle.key}`}>
          <Switch
            checked={kitchenPrefs.sections[toggle.key]}
            onCheckedChange={() => kitchenPrefs.toggleSection(toggle.key)}
            label={toggle.label}
            description={toggle.description}
          />
        </div>
      {/each}
    </div>

    <div class="flex flex-col gap-3">
      <h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Imagery</h3>
      <div data-testid="mine-customize-imagery">
        <Switch
          checked={kitchenPrefs.imagery}
          onCheckedChange={(v) => kitchenPrefs.setImagery(v)}
          label="Show recipe photos"
          description="Thumbnails on cooking-now, cooking-soon, and review cards."
        />
      </div>
    </div>

    <div class="flex flex-col gap-3" data-testid="mine-customize-density">
      <RadioGroup
        label="Layout"
        value={kitchenPrefs.density}
        onValueChange={onDensityChange}
        orientation="vertical"
      >
        <RadioGroupItem value="comfortable" label="Comfortable" />
        <RadioGroupItem value="compact" label="Compact" />
      </RadioGroup>
    </div>

    <SheetFooter>
      <Button
        variant="ghost"
        onclick={() => kitchenPrefs.reset()}
        data-testid="mine-customize-reset"
      >
        Reset to defaults
      </Button>
      <Button onclick={() => (customizeOpen = false)} data-testid="mine-customize-done">
        Done
      </Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
