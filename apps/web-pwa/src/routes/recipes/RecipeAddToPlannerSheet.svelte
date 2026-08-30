<script lang="ts">
  import {
    Button,
    Icon,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
  } from '@salt/ui-components';
  import { addCalendarDays, weekStartFor, type Recipe } from '@salt/domain';
  import { formatDayKey } from '../../lib/dateFormat.js';
  import { todayIso } from '../../lib/today.js';
  import { addRecipeToDay, firstDayOfWeek } from '../../lib/mealPlanService.js';
  import { addToast } from '../../lib/toastStore.js';

  // "Add to planner", from the recipe page.
  //
  // The calendar is hand-rolled rather than `<input type="date">` on purpose:
  // the native control hands the whole interaction to the OS, so the same app
  // shows a wheel on iOS, a Material dialog on Android and a drop-down on
  // desktop — none of them ours, none of them agreeing with each other, and none
  // of them able to start the week where this household starts it. This grid is
  // one control on every device, built from Salt primitives and the planner's own
  // `firstDayOfWeek`, so the row a date sits in here is the row it sits in there.
  //
  // Picking a day SELECTS it; the footer button commits. A month grid is dense
  // enough that commit-on-tap would write the plan on a mis-tap, and the confirm
  // names the day in words so what is about to happen is legible before it does.

  interface Props {
    recipe: Recipe;
    open: boolean;
  }
  let { recipe, open = $bindable() }: Props = $props();

  let selected = $state(todayIso());
  // First of the month on show. The grid derives from this; nothing else does.
  let monthAnchor = $state(`${todayIso().slice(0, 7)}-01`);
  let busy = $state(false);

  // Re-seed on each open: a sheet reopened tomorrow must not still be offering
  // yesterday, and a month the user browsed away to is not where the next
  // recipe's planning starts.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      selected = todayIso();
      monthAnchor = `${selected.slice(0, 7)}-01`;
    }
    wasOpen = open;
  });

  function shiftMonth(anchor: string, months: number): string {
    const [y, m] = anchor.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + months, 1));
    return d.toISOString().slice(0, 10);
  }

  // Last calendar day of the anchored month (day 0 of the next month).
  const monthEnd = $derived.by(() => {
    const [y, m] = monthAnchor.split('-').map(Number) as [number, number];
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  });

  // The grid: whole weeks, starting on the household's first day of the week, and
  // running from the week the 1st falls in to the week the last day falls in. So
  // the leading and trailing cells belong to the neighbouring months — they are
  // shown, and are pickable, because "the last day of last month" is a perfectly
  // ordinary night to plan and hiding it would mean a month-flip to reach it.
  const cells = $derived.by(() => {
    const out: string[] = [];
    let d = weekStartFor(monthAnchor, $firstDayOfWeek);
    while (d <= monthEnd || out.length % 7 !== 0) {
      out.push(d);
      d = addCalendarDays(d, 1);
    }
    return out;
  });

  const weekdayHeads = $derived(
    cells.slice(0, 7).map((d) => formatDayKey(d, { weekday: 'narrow' })),
  );

  const today = $derived(todayIso());
  const selectedLabel = $derived(
    formatDayKey(selected, { weekday: 'long', day: 'numeric', month: 'long' }),
  );

  function inMonth(date: string): boolean {
    return date.slice(0, 7) === monthAnchor.slice(0, 7);
  }

  async function handleConfirm(): Promise<void> {
    busy = true;
    const result = await addRecipeToDay(selected, recipe);
    busy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to add to the planner.', 'destructive');
      return;
    }
    open = false;
    addToast(
      result.value === 'already-there'
        ? `Already planned for ${selectedLabel}.`
        : `Added to ${selectedLabel}.`,
      'success',
    );
  }
</script>

<Sheet
  bind:open
  side="bottom"
  onOpenChange={(v) => {
    if (!v) busy = false;
  }}
>
  <SheetContent class="flex max-h-[85vh] flex-col gap-4 p-4 pb-8">
    <SheetHeader>
      <SheetTitle>Add to planner</SheetTitle>
    </SheetHeader>

    <p class="-mt-2 truncate text-sm text-muted-foreground" data-testid="planner-add-recipe-title">
      {recipe.title}
    </p>

    <!-- Month bar. Both arrows stay live in both directions: a past day is a
         legitimate thing to plan (recording what was actually eaten), so nothing
         here is disabled by the calendar. -->
    <div class="flex items-center justify-between">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => (monthAnchor = shiftMonth(monthAnchor, -1))}
        aria-label="Previous month"
        data-testid="planner-add-prev-month"
      >
        <Icon name="ChevronLeft" size={18} />
      </Button>
      <span class="text-sm font-medium" data-testid="planner-add-month">
        {formatDayKey(monthAnchor, { month: 'long', year: 'numeric' })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onclick={() => (monthAnchor = shiftMonth(monthAnchor, 1))}
        aria-label="Next month"
        data-testid="planner-add-next-month"
      >
        <Icon name="ChevronRight" size={18} />
      </Button>
    </div>

    <div class="overflow-y-auto">
      <div class="grid grid-cols-7 gap-1" aria-hidden="true">
        {#each weekdayHeads as head, i (i)}
          <span class="py-1 text-center text-xs font-semibold text-muted-foreground">{head}</span>
        {/each}
      </div>
      <div class="grid grid-cols-7 gap-1" data-testid="planner-add-calendar">
        {#each cells as date (date)}
          <button
            type="button"
            class="flex h-10 items-center justify-center rounded text-sm transition-colors
                   {date === selected
              ? 'bg-primary font-semibold text-primary-foreground'
              : inMonth(date)
                ? 'hover:bg-accent'
                : 'text-muted-foreground/60 hover:bg-accent'}
                   {date === today && date !== selected ? 'ring-1 ring-primary' : ''}"
            aria-pressed={date === selected}
            aria-label={formatDayKey(date, { weekday: 'long', day: 'numeric', month: 'long' })}
            onclick={() => (selected = date)}
            disabled={busy}
            data-testid="planner-add-day"
            data-date={date}
          >
            {formatDayKey(date, { day: 'numeric' })}
          </button>
        {/each}
      </div>
    </div>

    <SheetFooter class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={busy}
        >Cancel</Button
      >
      <Button
        size="sm"
        onclick={handleConfirm}
        loading={busy}
        disabled={busy}
        data-testid="recipe-add-to-planner-confirm"
      >
        Add to {selectedLabel}
      </Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
