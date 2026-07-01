<script lang="ts">
  import { Checkbox, Button } from '@salt/ui-components';
  import { ChevronDown, ChevronRight, ChefHat, StickyNote } from '@lucide/svelte';
  import { memberInitials, weatherIcon, type Day, type Member } from '@salt/domain';
  import type { WeatherDaySummary } from '@salt/domain/schemas';
  import WeatherSummary from './WeatherSummary.svelte';
  import WeatherIcon from '$lib/weather-icons/WeatherIcon.svelte';

  // Collapsible editor for a single Day, shared by the weekly page (date-keyed)
  // and the template editor (weekday-keyed). Collapsed it shows a one-line
  // summary — meal + who's in (with home time) + chef + a note indicator + guest
  // count — so the whole week scans fast; expand one day to edit detail in a
  // roomy panel. It knows nothing about day keys: the parent supplies handlers
  // already bound to the right date/weekday. Members resolve live; an unknown
  // memberId renders as removable, never blocking. See docs/meal-planning.md.
  //
  // `weather` (issue #382, Phase 3) is the OPTIONAL per-day evening forecast. The
  // PARENT does the in-window gating: the dated weekly page passes
  // `forecast?.days[date]` (present only for concrete in-window days), while the
  // weekday-keyed template editor never passes it — so weather renders only on
  // in-window dated days and is blank for past/far-future days and the template.
  interface Props {
    label: string;
    sublabel?: string;
    day: Day;
    members: Member[];
    testid: string;
    // `| undefined` so the parent can pass `forecast?.days[date]` directly under
    // exactOptionalPropertyTypes (noUncheckedIndexedAccess makes it optional).
    weather?: WeatherDaySummary | undefined;
    onNoteChange: (note: string) => void;
    onChefToggle: (memberId: string) => void;
    onAttendeeToggle: (memberId: string) => void;
    onAttendeeHomeTime: (memberId: string, homeTime: string | null) => void;
    onAttendeeNote: (memberId: string, note: string) => void;
    onGuestsChange: (guests: number) => void;
  }
  let {
    label,
    sublabel,
    day,
    members,
    testid,
    weather,
    onNoteChange,
    onChefToggle,
    onAttendeeToggle,
    onAttendeeHomeTime,
    onAttendeeNote,
    onGuestsChange,
  }: Props = $props();

  let open = $state(false);

  // The day's weather pictogram (issue #387), resolved from the forecast's
  // weatherCode/isDay. Null for absent/unknown codes — and, crucially, null for
  // every day the parent gives no `weather` (past, out-of-horizon, the template
  // row), so the watermark below simply doesn't render for them: graceful
  // absence identical to today's no-weather behaviour, no placeholder box.
  const icon = $derived(weather ? weatherIcon(weather) : null);

  // Home time stays blank by default; opening the picker on a blank field starts
  // from the usual dinner time rather than 00:00 (DOM-only — not persisted until
  // the user actually picks a value).
  const EDIT_START_TIME = '18:30';

  // Initial-chips grow to use the available width when there are few members and
  // shrink as the roster grows (the household is small, ~5, with rare guests).
  const chip = $derived(
    members.length <= 4
      ? { box: 'h-9 w-9 text-xs', h: 'h-9', time: 'text-[11px]', badge: 'h-4 w-4', hat: 'h-3 w-3' }
      : members.length <= 6
        ? {
            box: 'h-8 w-8 text-[11px]',
            h: 'h-8',
            time: 'text-[10px]',
            badge: 'h-3.5 w-3.5',
            hat: 'h-2.5 w-2.5',
          }
        : {
            box: 'h-7 w-7 text-[10px]',
            h: 'h-7',
            time: 'text-[9px]',
            badge: 'h-3 w-3',
            hat: 'h-2 w-2',
          },
  );

  const isAttending = (id: string): boolean => day.attendees.some((a) => a.memberId === id);
  const isChef = (id: string): boolean => day.chefs.includes(id);
  const attendeeOf = (id: string) => day.attendees.find((a) => a.memberId === id);

  // Attendees referencing someone no longer in the roster — rendered removable so
  // the document is never silently corrupted.
  const unknownAttendees = $derived(
    day.attendees.filter((a) => !members.some((m) => m.id === a.memberId)),
  );
  const attendingCount = $derived(day.attendees.length + day.guests);
  const hasNotes = $derived(day.attendees.some((a) => a.note.trim() !== ''));

  // Auto-grow the multiline meal field to fit its content. Re-runs whenever the
  // note changes (typing, or load-template swapping the value in).
  let noteEl: HTMLTextAreaElement | undefined = $state();
  $effect(() => {
    const _note = day.note; // track
    if (noteEl) {
      noteEl.style.height = 'auto';
      noteEl.style.height = `${noteEl.scrollHeight}px`;
    }
  });
</script>

<div class="overflow-hidden rounded-lg border" data-testid={testid}>
  <!-- Collapsed header (issue #387): the summary row + the evening-forecast strip,
       wrapped together (relative) so the weather pictogram can sit as a faint
       watermark in the LEFT column, centred in the empty space UNDER the weekday/
       date — not behind it. The watermark lane spans the full header height (top-0
       bottom-0) and overlays the label column (left-3, w-16); inside it an INVISIBLE
       clone of the weekday/date reserves the exact height the real label occupies
       (same font + w-16 wrapping — on every breakpoint and for every day, whether the
       weekday wraps or not), so the flex-1 region below it is PRECISELY the gap under
       the date. The icon centres in that gap and scales to fill it (h-16 capped by
       max-h/max-w-full + the component's object-contain): big where there's room (the
       tall, stacked mobile summary), smaller where it's tight (the short, inline
       desktop summary), always centred, never overlapping the text — no manual nudges
       and no breakpoint-specific offsets. (NB: keep the clone's font classes in sync
       with the real label spans below.) It's low in the stack (z-0) with the day text
       bumped above it (relative z-10); the temps sit in a further-right column
       (pl-[5.25rem]) so the icon never covers them. Renders ONLY when `icon` is
       non-null, so past / out-of-horizon / template days show nothing (no box).
       Opacity is lifted in dark mode, where the darker icons read fainter, to keep
       the day text legible. -->
  <!-- The whole collapsed header is ONE open/collapse unit: the hover tint lives
       here on the wrapper (not the button), so hovering anywhere over it — the
       summary row OR the forecast strip — lightens the entire header together. The
       detail panel below is a sibling (outside this div), so it's never tinted. -->
  <div class="relative transition-colors hover:bg-muted/40">
    {#if icon}
      <div
        class="pointer-events-none absolute bottom-0 left-3 top-0 z-0 flex w-16 flex-col items-stretch pt-2.5 leading-tight"
        aria-hidden="true"
      >
        <span class="invisible text-sm font-semibold">{label}</span>
        {#if sublabel}<span class="invisible text-[11px]">{sublabel}</span>{/if}
        <span class="flex min-h-0 flex-1 items-center justify-center pb-1">
          <WeatherIcon
            {icon}
            class="h-16 max-h-full w-16 max-w-full opacity-[0.66] dark:opacity-[0.77]"
          />
        </span>
      </div>
    {/if}

    <!-- Collapsed summary: tap anywhere to expand. (Hover tint is on the wrapper.) -->
    <button
      type="button"
      class="flex w-full items-start gap-5 px-3 py-2.5 text-left"
      onclick={() => (open = !open)}
      aria-expanded={open}
      data-testid={`${testid}-summary`}
    >
      <span class="flex w-16 shrink-0 flex-col leading-tight">
        <span class="relative z-10 text-sm font-semibold">{label}</span>
        {#if sublabel}<span class="relative z-10 text-[11px] text-muted-foreground">{sublabel}</span
          >{/if}
      </span>

      <span class="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-6">
        <span class="flex items-center gap-1.5 sm:flex-1">
          <span
            class="min-w-0 truncate text-sm {day.note
              ? 'text-foreground'
              : 'text-muted-foreground'}"
          >
            {day.note || 'No meal set'}
          </span>
          {#if hasNotes}
            <StickyNote
              class="h-4 w-4 shrink-0 text-primary"
              strokeWidth={2.5}
              aria-label="has notes"
              data-testid={`${testid}-note-indicator`}
            />
          {/if}
        </span>
        <span class="flex items-start gap-3 sm:shrink-0">
          <!-- Member chips: fixed roster → constant width, so they line up across
             every row regardless of guests. Slightly more relaxed on wide screens. -->
          <span class="flex items-start gap-2.5 lg:gap-4">
            {#each members as m (m.id)}
              {@const a = attendeeOf(m.id)}
              <span class="flex flex-col items-center gap-0.5">
                <span
                  class="relative flex {chip.box} items-center justify-center rounded-full font-semibold
                  {isAttending(m.id)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground/50'}"
                  title={m.name}
                  data-testid={`${testid}-chip-${m.id}`}
                >
                  {memberInitials(m.name)}
                  {#if isChef(m.id)}
                    <span
                      class="absolute -bottom-1 -right-1 flex {chip.badge} items-center justify-center rounded-full bg-amber-500 ring-2 ring-background"
                      aria-label="chef"
                    >
                      <ChefHat class="{chip.hat} text-white" strokeWidth={2.5} />
                    </span>
                  {/if}
                </span>
                {#if isAttending(m.id) && a?.homeTime}
                  <span class="{chip.time} tabular-nums text-muted-foreground">{a.homeTime}</span>
                {/if}
              </span>
            {/each}
          </span>
          <!-- Guests: their own reserved column so the member chips never shift. -->
          <span class="flex {chip.h} w-8 shrink-0 items-center justify-start">
            {#if day.guests > 0}
              <span
                class="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground"
                data-testid={`${testid}-guest-badge`}>+{day.guests}</span
              >
            {/if}
          </span>
        </span>
      </span>

      <span class="shrink-0 pt-0.5 text-muted-foreground" aria-hidden="true">
        {#if open}<ChevronDown class="h-4 w-4" />{:else}<ChevronRight class="h-4 w-4" />{/if}
      </span>
    </button>

    <!-- Evening forecast (issue #382, Phase 3) — rendered ONLY for in-window dated
       days (the parent passes `weather` then). Past/far-future days and the
       template never receive it, so this whole block is absent (no placeholder).
       Aligned under the day label so it reads as part of the day header. -->
    <!-- The forecast strip toggles the same card as the summary above, so the header
         reads as one unit: a click on its empty areas (left gutter, gaps, padding)
         expands / collapses. EXCEPT the metric chips, which render as buttons and own
         their tap-to-open tooltips — `closest('button')` lets those taps through
         untouched. Pointer-only by design: the summary button is the keyboard/AT
         disclosure control, so a second focusable control here would just be
         redundant noise — and the strip can't itself be a button (it contains the
         chip buttons). Hence the a11y ignores below: two SINGLE-code comments, not
         one multi-code comment, because Svelte 5.56 only honours the first code in a
         multi-code svelte-ignore. -->
    {#if weather}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="-mt-1 px-3 pb-2.5 pl-[5.25rem]"
        onclick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) open = !open;
        }}
      >
        <WeatherSummary {weather} testid={`${testid}-weather`} />
      </div>
    {/if}
  </div>

  {#if open}
    <div class="flex flex-col gap-3 border-t px-3 py-3" data-testid={`${testid}-detail`}>
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-foreground" for={`${testid}-note`}>Meal</label>
        <textarea
          bind:this={noteEl}
          id={`${testid}-note`}
          rows="1"
          class="w-full resize-none overflow-hidden rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="What's for dinner?"
          value={day.note}
          oninput={(e) => onNoteChange(e.currentTarget.value)}
          data-testid={`${testid}-note`}></textarea>
      </div>

      <div class="flex flex-col gap-2.5">
        <span class="text-xs font-medium text-muted-foreground">Who's eating</span>
        {#each members as m (m.id)}
          {@const a = attendeeOf(m.id)}
          <div class="flex flex-col gap-1" data-testid={`${testid}-attendee-${m.id}`}>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div class="w-28 shrink-0">
                <Checkbox
                  checked={isAttending(m.id)}
                  label={m.name}
                  onCheckedChange={() => onAttendeeToggle(m.id)}
                  data-testid={`${testid}-attend-${m.id}`}
                />
              </div>
              <!-- Chef is independent of attending: a chef need not eat. Plain
                   button (not the salt Button) so both states are fully Tailwind:
                   selected = filled amber, unselected = clear neutral. -->
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm font-medium transition-colors
                  {isChef(m.id)
                  ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                  : 'border-input bg-background text-muted-foreground hover:bg-muted'}"
                onclick={() => onChefToggle(m.id)}
                aria-pressed={isChef(m.id)}
                data-testid={`${testid}-chef-${m.id}`}
              >
                <ChefHat class="h-3.5 w-3.5" strokeWidth={2.5} /> Chef
              </button>
            </div>
            {#if isAttending(m.id)}
              <!-- Time entry sits to the left of the note; both share the same
                   height so the row reads as one control. -->
              <div class="ml-1 flex items-stretch gap-2">
                <input
                  type="time"
                  class="h-8 shrink-0 rounded-md border bg-background px-2 text-sm"
                  value={a?.homeTime ?? ''}
                  onfocus={(e) => {
                    // Seed the picker from the usual dinner time when blank (DOM
                    // only — nothing is saved until the user actually picks one).
                    if (e.currentTarget.value === '') e.currentTarget.value = EDIT_START_TIME;
                  }}
                  oninput={(e) => {
                    const v = e.currentTarget.value;
                    onAttendeeHomeTime(m.id, v === '' ? null : v);
                  }}
                  onblur={(e) => {
                    // Re-sync to the committed value, discarding an unpicked seed.
                    e.currentTarget.value = attendeeOf(m.id)?.homeTime ?? '';
                  }}
                  aria-label={`${m.name} home time`}
                  data-testid={`${testid}-time-${m.id}`}
                />
                <input
                  class="h-8 w-full flex-1 rounded-md border bg-background px-2 text-sm"
                  placeholder="Add a note (e.g. portion for tomorrow)"
                  value={a?.note ?? ''}
                  oninput={(e) => onAttendeeNote(m.id, e.currentTarget.value)}
                  aria-label={`${m.name} note`}
                  data-testid={`${testid}-attnote-${m.id}`}
                />
              </div>
            {/if}
          </div>
        {/each}

        {#each unknownAttendees as a (a.memberId)}
          <div
            class="flex items-center justify-between gap-2 rounded border border-dashed px-2 py-1.5"
            data-testid={`${testid}-unknown-${a.memberId}`}
          >
            <span class="truncate text-sm text-muted-foreground">
              Unknown member ({a.memberId})
            </span>
            <Button
              variant="ghost"
              size="sm"
              onclick={() => onAttendeeToggle(a.memberId)}
              data-testid={`${testid}-unknown-remove-${a.memberId}`}
            >
              Remove
            </Button>
          </div>
        {/each}

        <!-- Occasional unnamed guests: a simple count. -->
        <div class="flex items-center gap-2 pt-1" data-testid={`${testid}-guests`}>
          <span class="w-28 shrink-0 text-sm">Guests</span>
          <Button
            variant="outline"
            size="sm"
            disabled={day.guests <= 0}
            onclick={() => onGuestsChange(day.guests - 1)}
            aria-label="Fewer guests"
            data-testid={`${testid}-guests-dec`}
          >
            −
          </Button>
          <span class="w-6 text-center text-sm tabular-nums" data-testid={`${testid}-guests-count`}>
            {day.guests}
          </span>
          <Button
            variant="outline"
            size="sm"
            onclick={() => onGuestsChange(day.guests + 1)}
            aria-label="More guests"
            data-testid={`${testid}-guests-inc`}
          >
            +
          </Button>
        </div>
      </div>

      <p class="text-[11px] text-muted-foreground">
        {attendingCount}
        {attendingCount === 1 ? 'person' : 'people'} eating
      </p>
    </div>
  {/if}
</div>
