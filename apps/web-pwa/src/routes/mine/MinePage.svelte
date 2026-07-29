<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Card, Progress } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { ChefHat, CircleCheck, ShoppingCart, Sparkles } from '@lucide/svelte';
  import type { Recipe } from '@salt/domain';
  import WeatherSummary from '../mealplan/WeatherSummary.svelte';
  import RecipeAddToListSheet from '../recipes/RecipeAddToListSheet.svelte';
  import { thisWeek } from '../../lib/mealPlanService.js';
  import { defaultListId, itemsForActiveList } from '../../lib/shoppingListService.svelte.js';
  import { upcomingShopDay } from '../../lib/shoppingDayService.js';
  import { currentMember } from '../../lib/membersService.js';
  import {
    justHappened,
    liveCooks,
    needsYou,
    nowMs,
    tonight,
    yourWeek,
  } from '../../lib/personalViewService.js';
  import { addToast } from '../../lib/toastStore.js';

  // "Mine" (issue #634) — a personal view over family-shared data: not "here is the
  // household's state" (the planner and the list already say that) but "here is what
  // needs YOU, right now". Every card is a projection of a document that exists at
  // this moment; it appears when true and disappears when resolved. No read state,
  // no dismissals, nothing stored per user.
  //
  // Fixed order, hard-capped: Live → Tonight → Your week → Needs you → Just
  // happened → footer. Tonight and Your week are always there, so the page is never
  // blank; the queue is usually empty, so it is never noisy.

  // The week stores are module-level singletons that retain whatever week the
  // planner last showed. Reset to the current one on open, exactly as the planner
  // does — "tonight" and "your week" mean nothing against a browsed-away week.
  onMount(() => {
    thisWeek();
  });

  // ─── Date / time formatting ───────────────────────────────────────────────
  // Same UTC-anchored formatting the planner uses: the date keys are calendar
  // days, so they must not be re-interpreted in the local timezone.
  function fmt(date: string, opts: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00.000Z`),
    );
  }
  const dayName = (date: string) => fmt(date, { weekday: 'long' });
  const shortDay = (date: string) => fmt(date, { weekday: 'short' });

  // "Tonight's Noodle Bowl" reads better than "Friday's" when Friday is today.
  const today = $derived($tonight?.date ?? '');
  const possessive = (date: string) => (date === today ? "Tonight's" : `${dayName(date)}'s`);

  function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
  }

  // "4 min ago" / "3 hours ago". Only ever called for imports inside the 24-hour
  // window, so days never come into it.
  function ago(iso: string, now: number): string {
    const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return `${hours} ${plural(hours, 'hour', 'hours')} ago`;
  }

  // ─── Your week ────────────────────────────────────────────────────────────
  // "You're cooking Wed and Fri" — the one line that makes the strip readable at a
  // glance instead of a thing to decode.
  const chefDaysLine = $derived.by(() => {
    const days = $yourWeek.chefDates.map(shortDay);
    if (days.length === 0) return "You're not down to cook this week";
    if (days.length === 1) return `You're cooking ${days[0]}`;
    return `You're cooking ${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
  });

  // ─── Needs you ────────────────────────────────────────────────────────────
  // "Add all" opens the SAME review sheet the recipe and planner pages use, rather
  // than writing the list behind the user's back: the sheet is where servings,
  // buy-or-make and the near-threshold checks are decided.
  let addShopRecipe = $state<Recipe | null>(null);
  let addShopOpen = $state(false);

  function openAddToList(recipe: Recipe): void {
    if (!$defaultListId) {
      addToast('No shopping list found. Create one first.', 'destructive');
      return;
    }
    addShopRecipe = recipe;
    addShopOpen = true;
  }

  // ─── Footer ───────────────────────────────────────────────────────────────
  const outstandingItems = $derived($itemsForActiveList.filter((i) => !i.checked).length);

  const shopLine = $derived.by(() => {
    const shop = $upcomingShopDay;
    if (!shop) return 'No shop day set';
    const when =
      shop.date === today
        ? 'today'
        : shop.date === nextDay(today)
          ? 'tomorrow'
          : dayName(shop.date);
    return `Shopping ${when} ${shop.slot}`;
  });

  function nextDay(date: string): string {
    if (!date) return '';
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
</script>

<section class="flex flex-col gap-4 p-4 sm:p-6" data-testid="mine-page">
  <header class="flex flex-col gap-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">
      {$currentMember ? `${$currentMember.name.split(' ')[0]}'s Salt` : 'Mine'}
    </h1>
    <p class="text-sm text-muted-foreground">What needs you, right now.</p>
  </header>

  <!-- 1. Live — the things on this page happening this minute. All of them: a
       two-pan dinner is two open cooks, and hiding one would misreport the
       kitchen. Newest first. -->
  {#if $liveCooks.length > 0}
    <div class="flex flex-col gap-2" data-testid="mine-live">
      {#if $liveCooks.length > 1}
        <p class="text-xs font-medium uppercase tracking-wide text-primary">
          Cooking now · {$liveCooks.length} on the go
        </p>
      {/if}
      {#each $liveCooks as cook (cook.session.id)}
        <Card class="border-primary/40 bg-primary/5">
          <button
            type="button"
            class="w-full p-4 text-left"
            onclick={() => push(`/recipes/${cook.recipe.id}/cook`)}
            data-testid="mine-live-resume"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                {#if $liveCooks.length === 1}
                  <p class="text-xs font-medium uppercase tracking-wide text-primary">
                    Cooking now
                  </p>
                {/if}
                <p class="truncate text-base font-semibold text-foreground">
                  {cook.recipe.title}
                </p>
                <p class="text-sm text-muted-foreground" data-testid="mine-live-step">
                  {cook.stepCount > 0
                    ? `Step ${cook.stepNumber} of ${cook.stepCount}`
                    : 'Mise en place'}
                </p>
              </div>
              <span
                class="shrink-0 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              >
                Resume
              </span>
            </div>
            {#if cook.stepCount > 0}
              <Progress
                class="mt-3"
                value={cook.completedCount}
                max={cook.stepCount}
                ariaLabel={`Cook progress: ${cook.recipe.title}`}
              />
            {/if}
          </button>
        </Card>
      {/each}
    </div>
  {/if}

  <!-- 2. Tonight — the one household card, and what keeps the page from being
       blank on a day when nothing is personally yours. -->
  {#if $tonight}
    <div data-testid="mine-tonight">
      <Card class="p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tonight · {fmt($tonight.date, { weekday: 'long', day: 'numeric', month: 'short' })}
            </p>
            {#if $tonight.recipes.length > 0}
              <div class="mt-1 flex flex-col items-start gap-0.5">
                {#each $tonight.recipes as recipe (recipe.id)}
                  <button
                    type="button"
                    class="truncate text-base font-semibold text-foreground underline-offset-2 hover:underline"
                    onclick={() => push(`/recipes/${recipe.id}`)}
                  >
                    {recipe.title}
                  </button>
                {/each}
              </div>
            {:else if $tonight.note.trim() !== ''}
              <p class="mt-1 text-base font-semibold text-foreground">{$tonight.note}</p>
            {:else}
              <p class="mt-1 text-base text-muted-foreground" data-testid="mine-tonight-empty">
                Nothing planned yet
              </p>
            {/if}
          </div>
          {#if $tonight.mine}
            <span
              class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              data-testid="mine-tonight-yours"
            >
              Yours
            </span>
          {/if}
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {#if $tonight.chefs.length > 0}
            <span
              class="flex items-center gap-1 text-sm text-muted-foreground"
              data-testid="mine-tonight-chefs"
            >
              <ChefHat class="h-3.5 w-3.5" aria-hidden="true" />
              {$tonight.mine && $tonight.chefs.length === 1
                ? "You're cooking"
                : $tonight.chefs.map((c) => c.name.split(' ')[0]).join(' & ')}
            </span>
          {/if}
          {#if $tonight.weather}
            <WeatherSummary weather={$tonight.weather} testid="mine-tonight-weather" />
          {/if}
        </div>

        {#if !$tonight.planned}
          <Button
            variant="outline"
            size="sm"
            class="mt-3"
            onclick={() => push('/mealplan')}
            data-testid="mine-tonight-plan"
          >
            Plan tonight
          </Button>
        {/if}
      </Card>
    </div>
  {/if}

  <!-- 3. Your week — the nights you're down to cook, and the shop. -->
  <div data-testid="mine-week">
    <Card class="p-4">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-medium text-foreground" data-testid="mine-week-line">
          {chefDaysLine}
        </p>
      </div>
      <div class="mt-3 grid grid-cols-7 gap-1">
        {#each $yourWeek.days as day (day.date)}
          <button
            type="button"
            class="flex flex-col items-center gap-0.5 rounded px-1 py-1.5 text-xs transition-colors hover:bg-accent
              {day.mine ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground'}
              {day.isPast ? 'opacity-50' : ''}
              {day.isToday ? 'ring-1 ring-inset ring-border' : ''}"
            onclick={() => push(`/mealplan/${day.date}`)}
            data-testid={`mine-week-${day.date}`}
            data-mine={day.mine ? 'true' : undefined}
          >
            <span>{shortDay(day.date).slice(0, 3)}</span>
            <span class="text-sm tabular-nums">{fmt(day.date, { day: 'numeric' })}</span>
            {#if day.isShopDay}
              <ShoppingCart
                class="h-3 w-3 text-foreground"
                aria-label="Shop day"
                data-testid={`mine-week-shop-${day.date}`}
              />
            {:else}
              <span class="h-3"></span>
            {/if}
          </button>
        {/each}
      </div>
    </Card>
  </div>

  <!-- 4. Needs you — at most three, ranked, yours first. -->
  <div class="flex flex-col gap-2" data-testid="mine-needs-you">
    <h2 class="text-sm font-medium text-muted-foreground">Needs you</h2>
    {#if $needsYou.length === 0}
      <!-- The queue is empty most of the time, so this is the page's usual face:
           it should read as an achievement, not an absence. -->
      <Card class="p-4">
        <div class="flex items-center gap-3" data-testid="mine-needs-empty">
          <CircleCheck class="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p class="text-sm font-medium text-foreground">You're all caught up</p>
            <p class="text-xs text-muted-foreground">
              Nothing needs you right now — go and enjoy your evening.
            </p>
          </div>
        </div>
      </Card>
    {:else}
      {#each $needsYou as card (card.id)}
        <div data-testid="mine-needs-card">
          <Card class="p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                {#if card.kind === 'needs-check'}
                  <p class="text-sm font-medium text-foreground">
                    {card.count}
                    {plural(card.count, 'item', 'items')} on the list
                    {plural(card.count, 'needs', 'need')} a check
                  </p>
                  <p class="text-xs text-muted-foreground">
                    Flagged when they were added — confirm or drop them.
                  </p>
                {:else}
                  <p class="text-sm font-medium text-foreground">
                    {card.kind === 'unshopped-mine'
                      ? `${possessive(card.date)} ${card.recipe.title}`
                      : `${card.recipe.title} isn't shopped for`}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {card.kind === 'unshopped-mine'
                      ? `${card.missingCount} ${plural(card.missingCount, 'ingredient', 'ingredients')} aren't on the list — you're cooking it`
                      : `${dayName(card.date)} · not your night`}
                  </p>
                {/if}
                {#if card.urgent}
                  <p class="mt-1 text-xs font-medium text-primary" data-testid="mine-needs-urgent">
                    {shopLine}
                  </p>
                {/if}
              </div>
              {#if card.kind === 'needs-check'}
                <Button
                  size="sm"
                  variant="outline"
                  class="shrink-0"
                  onclick={() => push(`/shopping/${$defaultListId ?? ''}`)}
                >
                  Review
                </Button>
              {:else}
                <Button
                  size="sm"
                  class="shrink-0"
                  onclick={() => openAddToList(card.recipe)}
                  data-testid="mine-needs-add-all"
                >
                  Add all
                </Button>
              {/if}
            </div>
          </Card>
        </div>
      {/each}
    {/if}
  </div>

  <!-- 5. Just happened — the last 24 hours. Today that means one thing: an import
       that landed and has never been opened (the share-sheet recovery path). -->
  {#if $justHappened.length > 0}
    <div class="flex flex-col gap-2" data-testid="mine-just-happened">
      <h2 class="text-sm font-medium text-muted-foreground">Just happened</h2>
      {#each $justHappened as recipe (recipe.id)}
        <Card class="p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Sparkles class="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span class="truncate">{recipe.title}</span>
              </p>
              <p class="text-xs text-muted-foreground">
                Finished importing {ago(recipe.createdAt, $nowMs)} — you haven't opened it yet
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              class="shrink-0"
              onclick={() => push(`/recipes/${recipe.id}`)}
              data-testid="mine-just-happened-open"
            >
              Open
            </Button>
          </div>
        </Card>
      {/each}
    </div>
  {/if}

  <!-- 6. Footer — the shop and the list, in one line. -->
  <p class="text-xs text-muted-foreground" data-testid="mine-footer">
    {shopLine} · {outstandingItems}
    {plural(outstandingItems, 'item', 'items')} on the list
  </p>
</section>

<!-- The recipe review sheet, mounted once and driven by the selected card. Gated
     on a default list existing — mirrors the recipe and planner pages exactly. -->
{#if addShopRecipe && $defaultListId}
  <RecipeAddToListSheet recipe={addShopRecipe} listId={$defaultListId} bind:open={addShopOpen} />
{/if}
