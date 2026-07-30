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
    RadioGroup,
    RadioGroupItem,
  } from '@salt/ui-components';
  import { onMount } from 'svelte';
  import { ChevronLeft, ChevronRight, ChevronUp, ShoppingCart } from '@lucide/svelte';
  import {
    weekDates,
    dayIndexInWeek,
    weekExtendsIntoNext,
    templateWeekStarts,
    addCalendarDays,
    type Attendee,
    type Day,
    type Recipe,
  } from '@salt/domain';
  import type { ShoppingDayDoc, ShoppingSlot } from '@salt/domain/schemas';
  import type { DomainError, ReadResult } from '@salt/shared-types';
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
    firstDayOfWeek,
    extensionWeek,
    extensionStartDate,
    setExtensionWeek,
    nextWeek,
    prevWeek,
    thisWeek,
    goToWeek,
    loadTemplateIntoWeek,
    weekHasEdits,
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
  import {
    weekShopDay,
    extensionWeekShopDay,
    setShopDay,
    clearShopDay,
  } from '../../lib/shoppingDayService.js';

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
    // The extension (below) is a second live subscription on a module-level
    // singleton, so leaving the planner must drop it — otherwise the app keeps a
    // second week document and a second shop-day range read alive for a page
    // nobody is looking at.
    return () => setExtensionWeek(null);
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

  // ─── Next week appears from Wednesday (#639, Phase 6) ─────────────────────
  // You shop on Friday or Saturday and plan by Thursday, so for the last two days
  // of every cycle the week you need is the one you are NOT looking at. From then
  // on the whole of next week is appended beneath a dated mark — one continuous
  // scroll of thirteen or fourteen days from today, with both weeks' shop rules in
  // it.
  //
  // The trigger is "the last two days of the cycle", never the literal weekday:
  // Wednesday is only the answer because `firstDayOfWeek` is 'fri', and that is a
  // configurable setting. The predicate is pure and lives in domain (there is no
  // clock there, so today is passed in).
  //
  // The extension belongs to TODAY's week only. Navigating anywhere else drops it
  // — `weekExtendsIntoNext` is false for any week that does not contain today —
  // and prev/next still mean exactly one week.
  const extendsIntoNext = $derived(
    weekExtendsIntoNext($selectedStartDate, todayDate, $firstDayOfWeek),
  );

  // Ask the service to hold the second week (or to drop it). Everything else about
  // the extension follows from `extensionStartDate`: the week document, its
  // loading flag, and — with no wiring here at all — its shop marker.
  $effect(() => {
    const wanted = extendsIntoNext ? addCalendarDays($selectedStartDate, 7) : null;
    // Never ask for the week we are already showing: the service would hold one
    // subscription under two names and the deck would render the days twice.
    setExtensionWeek(wanted && wanted !== $selectedStartDate ? wanted : null);
  });

  const extensionDates = $derived($extensionStartDate ? weekDates($extensionStartDate) : []);

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

  // The deck's stops are BOTH weeks' rows in visual order (#639, Phase 6). One
  // deck, one gesture: next week is scrolled into, not paged to.
  const deck = createDeck({
    sections: () =>
      [...dates, ...extensionDates].map((d) => rowEls[d]).filter((el): el is HTMLElement => !!el),
    thresholds: PLANNER_THRESHOLDS,
  });

  // The cue appears once the deck has moved off the top — the same "you are not
  // at the beginning" fact the scroll listener used to report.
  const scrolled = $derived(deck.offset > 8);

  // Plain (untracked) on purpose: the anchor is a one-shot per displayed run of
  // days, and reading it must not make the effect below depend on it.
  let anchoredWeek: string | null = null;

  // Anchor once per displayed run of days. The rows only exist once the week's
  // data has arrived, so this re-runs until today's row is actually in the DOM.
  // `place` rather than `animateTo`: this is where the deck STARTS, not somewhere
  // it travels to, so there is nothing for reduced motion to short-circuit.
  $effect(() => {
    // Keyed by BOTH weeks: gaining or losing the extension changes how far the
    // deck can travel, so it is a new anchor, not the same one.
    const key = `${$selectedStartDate}|${$extensionStartDate}`;
    const lastExtensionRow = extensionDates.length ? rowEls[extensionDates[6]!] : null;
    const todayRow = todayIndex >= 0 ? rowEls[todayDate] : null;
    if (anchoredWeek === key) return;
    if (todayIndex < 0) {
      // Some other week: land at the top, not wherever the last week was left.
      deck.place(0);
      anchoredWeek = key;
      return;
    }
    if (!todayRow) return;
    // Wait for next week's rows before measuring. `offsetOf` clamps to the end of
    // the list, and the extension fires exactly when today is near the END of its
    // week — so without the appended days below it, today's row cannot reach the
    // top and would land clamped some way down instead.
    if (extensionDates.length && !lastExtensionRow) return;
    // `offsetOf` clamps to the end of the list, so a day late in the week lands
    // as high as the list allows rather than dragging blank space up behind it.
    deck.place(deck.offsetOf(todayRow) ?? 0);
    anchoredWeek = key;
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
  function rangeOf(ds: string[], withYear: boolean): string {
    if (ds.length !== 7) return '';
    const end: Intl.DateTimeFormatOptions = withYear
      ? { day: 'numeric', month: 'short', year: 'numeric' }
      : { day: 'numeric', month: 'short' };
    return `${fmt(ds[0]!, { day: 'numeric', month: 'short' })} – ${fmt(ds[6]!, end)}`;
  }

  // The header range stays the PRIMARY week's even when next week is appended:
  // prev/next still move one week, so relabelling it to span both would be a lie
  // about what the arrows do. Next week names itself, on its own mark, in place.
  const rangeLabel = $derived(rangeOf(dates, true));
  const extensionRangeLabel = $derived(rangeOf(extensionDates, false));

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
  // (marking a day clears any other in the same week) and keys its markers BY WEEK,
  // so with two weeks on screen each draws its own rule and marking next week's
  // shop never clears this week's.
  async function changeShopSlot(date: string, slot: ShoppingSlot | null): Promise<void> {
    const result = slot === null ? await clearShopDay(date) : await setShopDay(date, slot);
    if (result.kind !== 'ok') addToast('Failed to save the shopping day.', 'destructive');
  }

  // ─── Load template: which week? (#639, Phase 7) ───────────────────────────
  // The button used to fill whichever week happened to be displayed, silently,
  // behind a generic "are you sure". It now ASKS, offering three weeks anchored
  // on today — this one, next, and the one after that ("week commencing") — each
  // with its dates, and each carrying its OWN overwrite warning. One dialog: the
  // caution belongs against the week you are about to overwrite, not in a second
  // dialog that can only speak generally.
  const OFFER_TITLES = ['This week', 'Next week', 'Week commencing'];

  // What we know about a week's contents. `checking` and `unknown` are states we
  // say out loud rather than resolve optimistically: a week we could not read is
  // not a week we can promise is empty, and this dialog's only job is to be
  // specific about what would be lost.
  type WeekEdits = 'checking' | 'edits' | 'clear' | 'unknown';

  let showLoadPicker = $state(false);
  let pickedWeek = $state('');
  let weekEdits = $state<Record<string, WeekEdits>>({});
  let loadBusy = $state(false);
  // Discriminates the probes of one dialog opening from the last one's, so a slow
  // answer to a dismissed question can never paint a warning on a new question.
  let probeRun = 0;

  const offeredWeeks = $derived(templateWeekStarts(todayDate, $firstDayOfWeek));

  function requestLoadTemplate(): void {
    const weeks = offeredWeeks;
    // Default to the week you are looking at when it is one of the three, so the
    // old behaviour is still one tap away; otherwise this week.
    pickedWeek = weeks.includes($selectedStartDate) ? $selectedStartDate : weeks[0]!;
    weekEdits = Object.fromEntries(weeks.map((w) => [w, 'checking' as WeekEdits]));
    showLoadPicker = true;

    // Only one of these weeks is subscribed, so the rest are read (the service
    // answers from a held document when it has one). Errors never throw — they
    // land as `unknown` and the option says it could not be checked (Rule 10).
    const run = ++probeRun;
    for (const week of weeks) {
      void weekHasEdits(week).then((result) => {
        if (run !== probeRun) return;
        weekEdits = {
          ...weekEdits,
          [week]: result.kind !== 'ok' ? 'unknown' : result.value ? 'edits' : 'clear',
        };
      });
    }
  }

  async function doLoadTemplate(): Promise<void> {
    const target = pickedWeek;
    if (!target || loadBusy) return;
    loadBusy = true;
    const result = await loadTemplateIntoWeek(target);
    loadBusy = false;
    showLoadPicker = false;
    if (result.kind !== 'ok') {
      addToast('Failed to load the template.', 'destructive');
      return;
    }
    // Show the week that just changed. Filling a week you are not looking at and
    // staying put would leave the planner looking as though nothing happened.
    if (target !== $selectedStartDate) goToWeek(target);
  }

  // ─── Day-editor handlers (bound to a concrete date) ───────────────────────
  // Every day mutator routes to the document its DATE belongs in (Phase 5), so a
  // day in next week saves to next week with no week argument here. What that
  // routing can do is REFUSE — a week it has never read is not a week it can
  // safely overwrite — and with two weeks on screen a silent refusal would look
  // exactly like a saved edit. So results are surfaced, not discarded (Rule 10).
  async function save(op: Promise<ReadResult<void, DomainError>>): Promise<void> {
    const result = await op;
    if (result.kind !== 'ok') addToast('Failed to save the day.', 'destructive');
  }

  // The day being edited may belong to either week, so read it from whichever one
  // holds that date — `currentWeek.days` alone would report next week's days as
  // empty and silently reset them.
  function dayAt(date: string): Day | undefined {
    return $currentWeek.days[date] ?? $extensionWeek?.days[date];
  }

  function toggleChef(date: string, memberId: string): void {
    const chefs = dayAt(date)?.chefs ?? [];
    const next = chefs.includes(memberId)
      ? chefs.filter((c) => c !== memberId)
      : [...chefs, memberId];
    void save(setWeekDayChefs(date, next));
  }

  function toggleAttendee(date: string, memberId: string): void {
    const attending = dayAt(date)?.attendees.some((a) => a.memberId === memberId);
    if (attending) {
      void save(removeWeekAttendee(date, memberId));
    } else {
      // Home time starts blank; the picker seeds 18:30 when first opened.
      const attendee: Attendee = { memberId, homeTime: null, note: '' };
      void save(addWeekAttendee(date, attendee));
    }
  }
</script>

<!-- One week's worth of rows, rendered identically for the week you are on and for
     next week appended beneath it (#639, Phase 6). Everything that differs between
     the two is a parameter: which document the days come from, which shop marker
     applies, and whether "already behind us" can mean anything (it cannot in next
     week — all of it is ahead). Deliberately NOT a component: it is this page's
     own markup, and the rows must stay direct children of the deck column so the
     one gesture spans both weeks. -->
{#snippet weekRows(
  dateList: string[],
  days: Record<string, Day>,
  shop: ShoppingDayDoc | null,
  isExtension: boolean,
)}
  {#each dateList as date, i (date)}
    {@const day = days[date]}
    {@const isEarlier = !isExtension && todayIndex > 0 && i < todayIndex}
    {#if day}
      {#if shop?.date === date}
        <!-- The shop day is a RULE ACROSS THE LIST, not a badge on a row: a
             cart and the slot, then a hairline running to the edge, so the
             week visibly divides into "before the shop" and "after" wherever
             the shop happens to fall. Sibling of the rows, immediately above
             the day it marks. The slot is copy only — both nudge at the same
             hour the evening before — and stays lower-case in the DOM, with
             the caps done in CSS. Both weeks draw their own, so this week's
             shop and next week's are visible in the same scroll. -->
        <div class="-mb-2 flex items-center gap-2" data-testid={`day-${date}-shop-marker`}>
          <span
            class="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <ShoppingCart class="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            Shop · {shop.slot}
          </span>
          <span class="h-px flex-1 bg-border"></span>
        </div>
      {/if}
      <!-- The wrapper is the page's grip on the row: it is what we anchor the
           scroll to, what carries the quieter treatment for days already behind
           us, and what marks a row as belonging to next week. MealDayEditor
           itself is untouched (it is shared with the template editor, which has
           no notion of "today"). Today is excluded from the next-week rail
           treatment on purpose: today outranks which week it falls in, and keeps
           its filled teal disc wherever it is. -->
      <div
        bind:this={rowEls[date]}
        class="{isEarlier ? 'opacity-60' : ''} {isExtension && date !== todayDate
          ? 'planner-next-week-row'
          : ''}"
      >
        <MealDayEditor
          label={fmt(date, { weekday: 'short' })}
          sublabel={fmt(date, { day: 'numeric' })}
          {day}
          members={$members}
          recipes={$recipes}
          testid={`day-${date}`}
          isToday={date === todayDate}
          weather={$weatherForecast?.days[date]}
          shopSlot={shop?.date === date ? shop.slot : null}
          onShopSlotChange={(slot) => void changeShopSlot(date, slot)}
          onNoteChange={(note) => void save(setWeekDayNote(date, note))}
          onRecipesChange={(ids) => void save(setWeekDayRecipes(date, ids))}
          onRecipeAddToList={openRecipeAddToList}
          onChefToggle={(id) => toggleChef(date, id)}
          onAttendeeToggle={(id) => toggleAttendee(date, id)}
          onAttendeeHomeTime={(id, t) => void save(setWeekAttendeeHomeTime(date, id, t))}
          onAttendeeNote={(id, n) => void save(setWeekAttendeeNote(date, id, n))}
          onGuestsChange={(g) => void save(setWeekDayGuests(date, g))}
        />
      </div>
    {/if}
  {/each}
{/snippet}

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
             own object, held together by its rail and the air around it. From the
             last two days of the cycle a SECOND week follows in the same column
             (Phase 6) — one continuous deck of thirteen or fourteen days, not two
             lists and not a second scroller. -->
        <div
          bind:this={deck.contentEl}
          class="flex flex-col gap-6 pb-2 will-change-transform"
          style="transform: translate3d(0, {-deck.offset}px, 0)"
        >
          <!-- This week. Its rail's stem is the DEFAULT state of the same element
               next week recolours: one continuous line down the whole run of days,
               in the empty left margin of the rail column, so there is an edge to
               run the eye down (#639, "a continuous dated rail"). Solid and in the
               border ink — the shop rule's hairline weight — because next week's
               job is to differ from this, not the other way round. Decorative: the
               dates beside it say everything it says. -->
          <div class="relative flex flex-col gap-6">
            <span
              class="pointer-events-none absolute inset-y-0 left-0 w-0 border-l-2 border-border"
              data-testid="this-week-rail"
              aria-hidden="true"
            ></span>

            {@render weekRows(dates, $currentWeek.days, $weekShopDay, false)}
          </div>

          {#if extensionDates.length}
            <!-- Next week. Its rail is burnt terracotta and dashed — a HUE SHIFT at
                 the same weight, never a lighter tint, because "quieter" already
                 means "behind you" in this list and a recessive next week would
                 read as past. The colour is set once here, week-scoped, and read
                 by the mark, the stem and (via the scoped rule below) each row's
                 rail; MealDayEditor takes no new prop for it. -->
            <div
              class="planner-next-week relative flex flex-col gap-6"
              style="--planner-rail-ink: var(--color-tertiary-variant)"
              data-testid="next-week-block"
            >
              <!-- The rail's stem: one dashed line down the whole run of days, in
                   the empty left margin of the rail column so it never crosses the
                   dates it belongs to. Decorative — the mark below says it in words. -->
              <span
                class="pointer-events-none absolute inset-y-0 left-0 w-0 border-l-2 border-dashed"
                style="border-color: var(--planner-rail-ink)"
                aria-hidden="true"
              ></span>

              <!-- The dated mark. Same rule-across-the-list grammar as the shop day,
                   dashed and terracotta, and it names the dates so "next week" is a
                   fact rather than a direction. -->
              <div class="-mb-2 flex items-center gap-2" data-testid="next-week-mark">
                <span
                  class="shrink-0 text-xs font-semibold uppercase tracking-wider"
                  style="color: var(--planner-rail-ink)"
                >
                  Next week · {extensionRangeLabel}
                </span>
                <span
                  class="flex-1 border-t-2 border-dashed"
                  style="border-color: var(--planner-rail-ink)"
                ></span>
              </div>

              {@render weekRows(
                extensionDates,
                $extensionWeek?.days ?? {},
                $extensionWeekShopDay,
                true,
              )}
            </div>
          {/if}
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

<!-- Which week? (#639, Phase 7). The warning is INSIDE the option it is about —
     part of that radio's own label, so it is read out with the week it would
     overwrite — rather than one line of general caution under the group. -->
<Dialog open={showLoadPicker} onOpenChange={(v) => (showLoadPicker = v)}>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="load-template-picker">
      <DialogHeader>
        <DialogTitle>Load the standard template</DialogTitle>
        <DialogDescription>
          Choose a week to fill. Its days are replaced with the standard template.
        </DialogDescription>
      </DialogHeader>
      <RadioGroup
        label="Week to fill"
        value={pickedWeek}
        onValueChange={(v: string) => (pickedWeek = v)}
      >
        {#each offeredWeeks as start, i (start)}
          <RadioGroupItem value={start} class="items-start" disabled={loadBusy}>
            <span class="flex flex-col gap-0.5">
              <span class="text-sm font-medium text-foreground">{OFFER_TITLES[i]}</span>
              <span class="text-xs text-muted-foreground">{rangeOf(weekDates(start), false)}</span>
              {#if weekEdits[start] === 'edits'}
                <span
                  class="text-xs text-destructive"
                  data-testid={`load-template-warning-${start}`}
                >
                  Already has edits — they will be lost.
                </span>
              {:else if weekEdits[start] === 'unknown'}
                <span
                  class="text-xs text-destructive"
                  data-testid={`load-template-unknown-${start}`}
                >
                  Couldn't check this week for edits — it may have some.
                </span>
              {:else if weekEdits[start] === 'checking'}
                <span class="text-xs text-muted-foreground">Checking for edits…</span>
              {/if}
            </span>
          </RadioGroupItem>
        {/each}
      </RadioGroup>
      <DialogFooter>
        <Button variant="outline" onclick={() => (showLoadPicker = false)} disabled={loadBusy}>
          Cancel
        </Button>
        <Button
          onclick={doLoadTemplate}
          loading={loadBusy}
          disabled={loadBusy}
          data-testid="load-template-confirm-btn"
        >
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

<style>
  /* Next week's rail ink (#639, Phase 6).
   *
   * MealDayEditor's collapsed summary is SHARED with the template editor and is
   * settled markup, so the colour arrives as a week-scoped custom property on the
   * week block above rather than as a new prop — this rule is the only thing that
   * reaches into the row, and it reaches only for the two rail spans.
   *
   * `:global` deliberately: the selector is rooted at a class this page alone
   * writes, and Svelte's scoping cannot see through a conditional class
   * expression to keep the rule alive.
   *
   * `:nth-child(-n + 2)` is the rail's weekday word and its date, and stops short
   * of the third child — the evening forecast, which keeps its own
   * temperature-band colour. Today's row never carries this class (today outranks
   * which week it is in), so its filled teal disc is untouched. */
  :global(
    .planner-next-week-row [data-testid$='-summary'] > div:first-child > span:nth-child(-n + 2)
  ) {
    color: var(--planner-rail-ink);
  }
</style>
