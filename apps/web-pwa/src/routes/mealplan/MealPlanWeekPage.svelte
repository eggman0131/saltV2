<script lang="ts">
  import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    ListPage,
  } from '@salt/ui-components';
  import { onMount } from 'svelte';
  import { ChevronLeft, ChevronRight, ChevronUp, ShoppingCart } from '@lucide/svelte';
  import { weekDates, dayIndexInWeek, type Attendee, type Recipe } from '@salt/domain';
  import type { ShoppingSlot } from '@salt/domain/schemas';
  import MealDayEditor from './MealDayEditor.svelte';
  import RecipeAddToListSheet from '../recipes/RecipeAddToListSheet.svelte';
  import { createDeck } from '../../lib/deck.svelte.js';
  import type { DeckThresholds } from '../../lib/cookDeck.js';
  import { members } from '../../lib/membersService.js';
  import { recipes } from '../../lib/recipeService.js';
  import { defaultListId } from '../../lib/shoppingListService.svelte.js';
  import {
    currentWeek,
    selectedStartDate,
    isLoadingMealPlanWeek,
    nextWeek,
    prevWeek,
    thisWeek,
    goToWeek,
    loadTemplateIntoCurrentWeek,
    setWeekDayNote,
    setWeekDayChefs,
    setWeekDayRecipes,
    setWeekDayGuests,
    addWeekAttendee,
    removeWeekAttendee,
    setWeekAttendeeHomeTime,
    setWeekAttendeeNote,
  } from '../../lib/mealPlanService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { weatherForecast, ensureFreshForecast } from '../../lib/weatherService.js';
  import { weekShopDay, setShopDay, clearShopDay } from '../../lib/shoppingDayService.js';

  // Optional `/mealplan/:date` — the week containing this date is opened instead
  // of the current one (issue #629): the shopping list's shop-day chip deep-links
  // to the week it is stocking for, which may be next week's.
  interface Props {
    params?: { date?: string } | undefined;
  }
  let { params }: Props = $props();

  // The week store is a module-level singleton, so it retains whatever week was
  // last viewed. Reset to the current week each time the planner is opened —
  // unless the route named a date to land on.
  onMount(() => {
    const routeDate = params?.date;
    if (routeDate) goToWeek(routeDate);
    else thisWeek();
    // On-access weather refresh (issue #382, Phase 3): silently refetch the
    // forecast when the cache is stale (>1h or the home location moved) and a home
    // location is set. No-ops otherwise; never blocks — the cache subscription
    // updates the day cells in place when the new doc arrives.
    void ensureFreshForecast();
  });

  const dates = $derived(weekDates($selectedStartDate));

  // Today, as the same local `YYYY-MM-DD` the week is keyed by (en-CA renders
  // local-tz ISO order — the trick mealPlanService already uses). Read once per
  // mount: the planner is remounted on every visit, and a week view that ticks
  // over at midnight while open is not worth a timer.
  const todayDate = new Date().toLocaleDateString('en-CA');

  // ─── Land on today (#639, Phase 2) ────────────────────────────────────────
  // The week OPENS ON TODAY: today's row is put directly under the sticky app
  // header on load, rather than the week starting on Friday and today landing
  // wherever it falls. The earlier days of the week are still there, full size,
  // immediately above — nothing is folded away or hidden behind a control, you
  // simply scroll up. They render a step quieter, so scrolling up reads as
  // looking backwards.
  //
  // `todayIndex` is the whole state machine: -1 means the displayed week does
  // not contain today (so we land at the top and show no cue), and otherwise it
  // is both today's row and the number of earlier days above it.
  const todayIndex = $derived(dayIndexInWeek($selectedStartDate, todayDate));

  // ─── The deck (#639, Phase 4) ─────────────────────────────────────────────
  // The week is a DECK, not a scroller: dragging moves the list under the thumb
  // 1:1 and on release it settles onto a day with a spring, resisting past either
  // end — the same machinery cook mode pages its steps with, extracted in Phase 3.
  //
  // The page therefore owns its own scrolling surface, which is what `fill` on
  // ListPage is for (ui-spec-v05 §1): it hands the page the shell's leftover
  // height so the deck viewport has something definite to size against, and a
  // page that exactly fills `<main>` leaves it nothing to scroll. No pixel
  // arithmetic against the shell chrome, and no browser storage — scroll position
  // is never persisted (Rule 3).
  let rowEls = $state<Record<string, HTMLElement | null>>({});

  // Cook mode's thresholds assume a section fills the screen. A day card is
  // ~200px, so `screen * 0.22` would be most of a card and a normal drag would
  // almost never commit — the ratio is a fraction of the VIEWPORT, so a smaller
  // one is what shortens the throw. 0.08 of a ~700px viewport ≈ 56px, about a
  // third of a card. The fling threshold drops with it so a light flick still
  // turns a day; projection and overhang slack keep cook mode's values.
  const PLANNER_THRESHOLDS: DeckThresholds = { commitRatio: 0.08, flingPxPerMs: 0.35 };

  const deck = createDeck({
    sections: () => dates.map((d) => rowEls[d]).filter((el): el is HTMLElement => !!el),
    thresholds: PLANNER_THRESHOLDS,
  });

  // The cue appears once the deck has moved off the top — the same "you are not
  // at the beginning" fact the scroll listener used to report.
  const scrolled = $derived(deck.offset > 8);

  // Plain (untracked) on purpose: the anchor is a one-shot per displayed week,
  // and reading it must not make the effect below depend on it.
  let anchoredWeek: string | null = null;

  // Anchor once per displayed week. The rows only exist once the week's data has
  // arrived, so this re-runs until today's row is actually in the DOM. `place`
  // rather than `animateTo`: this is where the deck STARTS, not somewhere it
  // travels to, so there is nothing for reduced motion to short-circuit.
  $effect(() => {
    const week = $selectedStartDate;
    const todayRow = todayIndex >= 0 ? rowEls[todayDate] : null;
    if (anchoredWeek === week) return;
    if (todayIndex < 0) {
      // Some other week: land at the top, not wherever the last week was left.
      deck.place(0);
      anchoredWeek = week;
      return;
    }
    if (!todayRow) return;
    // `offsetOf` clamps to the end of the list, so a day late in the week lands
    // as high as the list allows rather than dragging blank space up behind it.
    deck.place(deck.offsetOf(todayRow) ?? 0);
    anchoredWeek = week;
  });

  function scrollToEarliest(): void {
    deck.animateTo(0);
  }

  // Friendly labels for the week range and each day, formatted from the UTC date.
  function fmt(date: string, opts: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00.000Z`),
    );
  }
  const rangeLabel = $derived(
    dates.length === 7
      ? `${fmt(dates[0]!, { day: 'numeric', month: 'short' })} – ${fmt(dates[6]!, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}`
      : '',
  );

  // ─── Add a day's recipe to the shopping list (Phase 4, #469) ──────────────
  // The RecipeAddToListSheet is lifted to the page (kept OUT of the shared, recipe-
  // free MealDayEditor). A row's "Add to shop" hands its full Recipe up here; we
  // guard exactly as RecipeViewPage does — a missing default list shows the same
  // friendly toast and never opens the sheet — then mount the familiar review sheet.
  let addShopRecipe = $state<Recipe | null>(null);
  let addShopOpen = $state(false);

  function openRecipeAddToList(recipe: Recipe): void {
    if (!$defaultListId) {
      addToast('No shopping list found. Create one first.', 'destructive');
      return;
    }
    addShopRecipe = recipe;
    addShopOpen = true;
  }

  // ─── Shop day (issue #629) ────────────────────────────────────────────────
  // The shop marker sits INSIDE the week wherever it falls — `firstDayOfWeek` and
  // the layout above are completely untouched, so the shop can move freely week to
  // week without disturbing anything. The service owns the one-shop-per-week rule
  // (marking a day clears any other in the same week).
  const shopDate = $derived($weekShopDay?.date ?? null);

  async function changeShopSlot(date: string, slot: ShoppingSlot | null): Promise<void> {
    const result = slot === null ? await clearShopDay(date) : await setShopDay(date, slot);
    if (result.kind !== 'ok') addToast('Failed to save the shopping day.', 'destructive');
  }

  // ─── Load-template confirmation ───────────────────────────────────────────
  let showLoadConfirm = $state(false);

  function requestLoadTemplate(): void {
    // Only confirm when the week has already been edited (persisted).
    if ($currentWeek.updatedAt !== '') {
      showLoadConfirm = true;
    } else {
      void doLoadTemplate();
    }
  }

  async function doLoadTemplate(): Promise<void> {
    showLoadConfirm = false;
    const result = await loadTemplateIntoCurrentWeek();
    if (result.kind !== 'ok') addToast('Failed to load the template.', 'destructive');
  }

  // ─── Day-editor handlers (bound to a concrete date) ───────────────────────
  function toggleChef(date: string, memberId: string): void {
    const chefs = $currentWeek.days[date]?.chefs ?? [];
    const next = chefs.includes(memberId)
      ? chefs.filter((c) => c !== memberId)
      : [...chefs, memberId];
    void setWeekDayChefs(date, next);
  }

  function toggleAttendee(date: string, memberId: string): void {
    const attending = $currentWeek.days[date]?.attendees.some((a) => a.memberId === memberId);
    if (attending) {
      void removeWeekAttendee(date, memberId);
    } else {
      // Home time starts blank; the picker seeds 18:30 when first opened.
      const attendee: Attendee = { memberId, homeTime: null, note: '' };
      void addWeekAttendee(date, attendee);
    }
  }
</script>

<ListPage title="Meal plan" isLoading={$isLoadingMealPlanWeek} fill class="p-4 sm:p-6">
  {#snippet actions()}
    <Button size="sm" onclick={requestLoadTemplate} data-testid="load-template">
      Load template
    </Button>
  {/snippet}

  {#snippet children()}
    <div class="flex items-center justify-between gap-2" data-testid="week-nav">
      <Button variant="outline" size="sm" onclick={prevWeek} aria-label="Previous week">
        <ChevronLeft class="h-4 w-4" />
      </Button>
      <div class="flex flex-col items-center">
        <span class="text-sm font-medium" data-testid="week-range">{rangeLabel}</span>
        <button
          class="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onclick={thisWeek}
          data-testid="this-week"
        >
          This week
        </button>
      </div>
      <Button variant="outline" size="sm" onclick={nextWeek} aria-label="Next week">
        <ChevronRight class="h-4 w-4" />
      </Button>
    </div>

    <!-- The deck. The viewport is the clipping box — it takes the height ListPage's
         `fill` hands down — and the column inside it is moved by a transform, so
         this page owns the gesture end to end rather than sharing a scroller with
         the shell. The cue overlay is a SIBLING of the viewport, not a child of the
         moving column: `sticky` means nothing inside a transformed element, and an
         overlay that travelled with the days would defeat the point of pinning it. -->
    <div class="relative mt-4 flex min-h-0 flex-1 flex-col">
      <!-- A native scroller is focusable and arrow-key operable for free, and this
           element replaces one, so the tabindex and the key handler are how that
           behaviour is KEPT rather than dropped — the same trade cook mode makes.
           Cook mode can use a bare <main> for its viewport because it is a
           full-viewport page; here the shell already owns the <main>, so the role
           is stated explicitly rather than nesting a second landmark. Named after
           the week it holds, so the region announces what it contains. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        bind:this={deck.viewportEl}
        class="relative min-h-0 flex-1 touch-pinch-zoom overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        role="region"
        tabindex="0"
        aria-label="Week of {rangeLabel}"
        data-testid="week-deck"
        onpointerdown={deck.handlePointerDown}
        onpointermove={deck.handlePointerMove}
        onpointerup={deck.handlePointerUp}
        onpointercancel={deck.handlePointerUp}
        onwheel={deck.handleWheel}
        onkeydown={deck.handleKeyDown}
      >
        <!-- The week as one list of dated days, 24px apart (#639): each row is its
             own object, held together by its rail and the air around it. -->
        <div
          bind:this={deck.contentEl}
          class="flex flex-col gap-6 pb-2 will-change-transform"
          style="transform: translate3d(0, {-deck.offset}px, 0)"
        >
          {#each dates as date, i (date)}
            {@const day = $currentWeek.days[date]}
            {@const isEarlier = todayIndex > 0 && i < todayIndex}
            {#if day}
              {#if shopDate === date}
                <!-- The shop day is a RULE ACROSS THE LIST, not a badge on a row: a
                 cart and the slot, then a hairline running to the edge, so the
                 week visibly divides into "before the shop" and "after" wherever
                 the shop happens to fall. Sibling of the rows, immediately above
                 the day it marks. The slot is copy only — both nudge at the same
                 hour the evening before — and stays lower-case in the DOM, with
                 the caps done in CSS. -->
                <div class="-mb-2 flex items-center gap-2" data-testid={`day-${date}-shop-marker`}>
                  <span
                    class="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    <ShoppingCart class="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                    Shop · {$weekShopDay?.slot}
                  </span>
                  <span class="h-px flex-1 bg-border"></span>
                </div>
              {/if}
              <!-- The wrapper is the page's grip on the row: it is what we anchor the
               scroll to, and what carries the quieter treatment for days already
               behind us. MealDayEditor itself is untouched (it is shared with the
               template editor, which has no notion of "today"). -->
              <div bind:this={rowEls[date]} class={isEarlier ? 'opacity-60' : ''}>
                <MealDayEditor
                  label={fmt(date, { weekday: 'short' })}
                  sublabel={fmt(date, { day: 'numeric' })}
                  {day}
                  members={$members}
                  recipes={$recipes}
                  testid={`day-${date}`}
                  isToday={date === todayDate}
                  weather={$weatherForecast?.days[date]}
                  shopSlot={shopDate === date ? ($weekShopDay?.slot ?? null) : null}
                  onShopSlotChange={(slot) => void changeShopSlot(date, slot)}
                  onNoteChange={(note) => void setWeekDayNote(date, note)}
                  onRecipesChange={(ids) => void setWeekDayRecipes(date, ids)}
                  onRecipeAddToList={openRecipeAddToList}
                  onChefToggle={(id) => toggleChef(date, id)}
                  onAttendeeToggle={(id) => toggleAttendee(date, id)}
                  onAttendeeHomeTime={(id, t) => void setWeekAttendeeHomeTime(date, id, t)}
                  onAttendeeNote={(id, n) => void setWeekAttendeeNote(date, id, n)}
                  onGuestsChange={(g) => void setWeekDayGuests(date, g)}
                />
              </div>
            {/if}
          {/each}
        </div>
      </div>

      <!-- The scroll-up cue (#639, Phase 2). Landing mid-list gives no clue there
           is anything above, so once the deck has moved a shadow appears under the
           sticky app header and — when the week is today's — a pill names the
           earlier days and takes you back to them. Zero-height and pinned to the
           top of the viewport, so it costs the list no space and today's row still
           sits flush under the header; `-mx-4 sm:-mx-6` cancels this page's own
           ListPage padding so the shadow runs edge to edge. -->
      {#if scrolled}
        <div class="pointer-events-none absolute inset-x-0 top-0 z-10 -mx-4 sm:-mx-6">
          <div
            class="h-3 w-full bg-gradient-to-b from-foreground/10 to-transparent"
            data-testid="scroll-shadow"
          ></div>
          {#if todayIndex > 0}
            <div class="flex justify-center">
              <button
                type="button"
                class="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm"
                onclick={scrollToEarliest}
                data-testid="earlier-days"
              >
                <ChevronUp class="h-3.5 w-3.5" aria-hidden="true" />
                {todayIndex} earlier {todayIndex === 1 ? 'day' : 'days'}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/snippet}
</ListPage>

<Dialog open={showLoadConfirm} onOpenChange={(v) => (showLoadConfirm = v)}>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="load-template-confirm">
      <DialogHeader>
        <DialogTitle>Load the standard template?</DialogTitle>
        <DialogDescription>
          This overwrites this week's days back to the standard template. Any edits you've made to
          this week will be lost.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (showLoadConfirm = false)}>Cancel</Button>
        <Button onclick={doLoadTemplate} data-testid="load-template-confirm-btn">
          Load template
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>

<!-- Add a day's recipe to the shopping list: the same review sheet the recipe page
     uses (issue #185), mounted once and driven by the selected recipe. Gated on a
     default list existing — mirrors RecipeViewPage exactly. -->
{#if addShopRecipe && $defaultListId}
  <RecipeAddToListSheet recipe={addShopRecipe} listId={$defaultListId} bind:open={addShopOpen} />
{/if}
