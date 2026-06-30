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
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { weekDates, type Attendee } from '@salt/domain';
  import MealDayEditor from './MealDayEditor.svelte';
  import { members } from '../../lib/membersService.js';
  import {
    currentWeek,
    selectedStartDate,
    isLoadingMealPlanWeek,
    nextWeek,
    prevWeek,
    thisWeek,
    loadTemplateIntoCurrentWeek,
    setWeekDayNote,
    setWeekDayChefs,
    setWeekDayGuests,
    addWeekAttendee,
    removeWeekAttendee,
    setWeekAttendeeHomeTime,
    setWeekAttendeeNote,
  } from '../../lib/mealPlanService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { weatherForecast, ensureFreshForecast } from '../../lib/weatherService.js';

  // The week store is a module-level singleton, so it retains whatever week was
  // last viewed. Reset to the current week each time the planner is opened.
  onMount(() => {
    thisWeek();
    // On-access weather refresh (issue #382, Phase 3): silently refetch the
    // forecast when the cache is stale (>1h or the home location moved) and a home
    // location is set. No-ops otherwise; never blocks — the cache subscription
    // updates the day cells in place when the new doc arrives.
    void ensureFreshForecast();
  });

  const dates = $derived(weekDates($selectedStartDate));

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
    if (result.kind !== 'ok') addToast('Failed to load the template.', 'error');
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

<ListPage title="Meal plan" isLoading={$isLoadingMealPlanWeek} class="p-4 sm:p-6">
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

    <div class="mt-4 flex flex-col gap-3">
      {#each dates as date (date)}
        {@const day = $currentWeek.days[date]}
        {#if day}
          <MealDayEditor
            label={fmt(date, { weekday: 'long' })}
            sublabel={fmt(date, { day: 'numeric', month: 'short' })}
            {day}
            members={$members}
            testid={`day-${date}`}
            weather={$weatherForecast?.days[date]}
            onNoteChange={(note) => void setWeekDayNote(date, note)}
            onChefToggle={(id) => toggleChef(date, id)}
            onAttendeeToggle={(id) => toggleAttendee(date, id)}
            onAttendeeHomeTime={(id, t) => void setWeekAttendeeHomeTime(date, id, t)}
            onAttendeeNote={(id, n) => void setWeekAttendeeNote(date, id, n)}
            onGuestsChange={(g) => void setWeekDayGuests(date, g)}
          />
        {/if}
      {/each}
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
