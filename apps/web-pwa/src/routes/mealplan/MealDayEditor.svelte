<script lang="ts">
  import { TextField, Checkbox, Button } from '@salt/ui-components';
  import { ChevronDown, ChevronRight, ChefHat, StickyNote } from '@lucide/svelte';
  import { memberInitials, type Day, type Member } from '@salt/domain';

  // Collapsible editor for a single Day, shared by the weekly page (date-keyed)
  // and the template editor (weekday-keyed). Collapsed it shows a one-line
  // summary — meal + who's in (with home time) + chef + a note indicator + guest
  // count — so the whole week scans fast; expand one day to edit detail in a
  // roomy panel. It knows nothing about day keys: the parent supplies handlers
  // already bound to the right date/weekday. Members resolve live; an unknown
  // memberId renders as removable, never blocking. See docs/meal-planning.md.
  interface Props {
    label: string;
    sublabel?: string;
    day: Day;
    members: Member[];
    testid: string;
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
    onNoteChange,
    onChefToggle,
    onAttendeeToggle,
    onAttendeeHomeTime,
    onAttendeeNote,
    onGuestsChange,
  }: Props = $props();

  let open = $state(false);

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
</script>

<div class="overflow-hidden rounded-lg border" data-testid={testid}>
  <!-- Collapsed summary: tap anywhere to expand. -->
  <button
    type="button"
    class="flex w-full items-start gap-5 px-3 py-2.5 text-left hover:bg-muted/40"
    onclick={() => (open = !open)}
    aria-expanded={open}
    data-testid={`${testid}-summary`}
  >
    <span class="flex w-16 shrink-0 flex-col leading-tight">
      <span class="text-sm font-semibold">{label}</span>
      {#if sublabel}<span class="text-[11px] text-muted-foreground">{sublabel}</span>{/if}
    </span>

    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5">
        <span
          class="min-w-0 truncate text-sm {day.note ? 'text-foreground' : 'text-muted-foreground'}"
        >
          {day.note || 'No meal set'}
        </span>
        {#if hasNotes}
          <StickyNote
            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-label="has notes"
            data-testid={`${testid}-note-indicator`}
          />
        {/if}
      </span>
      <span class="mt-1 flex flex-wrap items-start gap-1.5">
        {#each members as m (m.id)}
          {@const a = attendeeOf(m.id)}
          <span class="flex flex-col items-center gap-0.5">
            <span
              class="relative flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold
                {isAttending(m.id)
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground/50'}"
              title={m.name}
              data-testid={`${testid}-chip-${m.id}`}
            >
              {memberInitials(m.name)}
              {#if isChef(m.id)}
                <span
                  class="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-background"
                  aria-label="chef"
                >
                  <ChefHat class="h-2.5 w-2.5 text-primary" />
                </span>
              {/if}
            </span>
            {#if isAttending(m.id) && a?.homeTime}
              <span class="text-[9px] tabular-nums text-muted-foreground">{a.homeTime}</span>
            {/if}
          </span>
        {/each}
        {#if day.guests > 0}
          <span
            class="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground"
            data-testid={`${testid}-guest-badge`}>+{day.guests}</span
          >
        {/if}
      </span>
    </span>

    <span class="shrink-0 pt-0.5 text-muted-foreground" aria-hidden="true">
      {#if open}<ChevronDown class="h-4 w-4" />{:else}<ChevronRight class="h-4 w-4" />{/if}
    </span>
  </button>

  {#if open}
    <div class="flex flex-col gap-3 border-t px-3 py-3" data-testid={`${testid}-detail`}>
      <TextField
        label="Meal"
        placeholder="What's for dinner?"
        value={day.note}
        onValueChange={(v) => onNoteChange(v)}
        data-testid={`${testid}-note`}
      />

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
              {#if isAttending(m.id) || isChef(m.id)}
                <input
                  type="time"
                  class="h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-40"
                  value={a?.homeTime ?? ''}
                  disabled={!isAttending(m.id)}
                  oninput={(e) => {
                    const v = e.currentTarget.value;
                    onAttendeeHomeTime(m.id, v === '' ? null : v);
                  }}
                  aria-label={`${m.name} home time`}
                  data-testid={`${testid}-time-${m.id}`}
                />
                <Button
                  variant={isChef(m.id) ? 'default' : 'outline'}
                  size="sm"
                  onclick={() => onChefToggle(m.id)}
                  data-testid={`${testid}-chef-${m.id}`}
                >
                  <ChefHat class="mr-1 h-3.5 w-3.5" /> Chef
                </Button>
              {/if}
            </div>
            {#if isAttending(m.id)}
              <input
                class="ml-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
                placeholder="Add a note (e.g. portion for tomorrow)"
                value={a?.note ?? ''}
                oninput={(e) => onAttendeeNote(m.id, e.currentTarget.value)}
                aria-label={`${m.name} note`}
                data-testid={`${testid}-attnote-${m.id}`}
              />
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
