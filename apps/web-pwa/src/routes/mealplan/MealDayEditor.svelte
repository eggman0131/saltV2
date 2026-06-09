<script lang="ts">
  import { TextField, Checkbox, Button } from '@salt/ui-components';
  import { memberInitials, type Day, type Member } from '@salt/domain';

  // Presentational editor for a single Day, shared by the weekly page (date-keyed)
  // and the template editor (weekday-keyed). It knows nothing about day keys: the
  // parent supplies handlers already bound to the correct date/weekday. Members
  // are resolved live; a memberId with no matching member renders as unknown +
  // removable. See docs/meal-planning.md.
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
  }: Props = $props();

  const memberName = (id: string): string | null => members.find((m) => m.id === id)?.name ?? null;
  const isAttending = (id: string): boolean => day.attendees.some((a) => a.memberId === id);
  const isChef = (id: string): boolean => day.chefs.includes(id);

  // Attendees referencing someone no longer in the members roster — rendered so
  // the document is never silently corrupted; removable, never blocking.
  const unknownAttendees = $derived(
    day.attendees.filter((a) => !members.some((m) => m.id === a.memberId)),
  );
</script>

<div class="flex flex-col gap-3 rounded-lg border p-4" data-testid={testid} data-day={testid}>
  <div class="flex items-baseline justify-between gap-2">
    <h3 class="text-sm font-semibold text-foreground">{label}</h3>
    {#if sublabel}
      <span class="text-xs text-muted-foreground">{sublabel}</span>
    {/if}
  </div>

  <TextField
    label="Meal"
    placeholder="What's for dinner?"
    value={day.note}
    onValueChange={(v) => onNoteChange(v)}
    data-testid={`${testid}-note`}
  />

  <!-- Chefs: zero or more; a chef need not be an attendee. -->
  <fieldset class="flex flex-col gap-1.5">
    <legend class="text-xs font-medium text-muted-foreground">Chefs</legend>
    <div class="flex flex-wrap gap-x-4 gap-y-1.5">
      {#each members as m (m.id)}
        <Checkbox
          checked={isChef(m.id)}
          label={m.name}
          onCheckedChange={() => onChefToggle(m.id)}
          data-testid={`${testid}-chef-${m.id}`}
        />
      {/each}
    </div>
  </fieldset>

  <!-- Attendees: tick to attend, then set an optional home time + per-person note. -->
  <fieldset class="flex flex-col gap-2">
    <legend class="text-xs font-medium text-muted-foreground">Attendees</legend>
    {#each members as m (m.id)}
      <div class="flex flex-col gap-1.5" data-testid={`${testid}-attendee-${m.id}`}>
        <Checkbox
          checked={isAttending(m.id)}
          label={m.name}
          onCheckedChange={() => onAttendeeToggle(m.id)}
          data-testid={`${testid}-attend-${m.id}`}
        />
        {#if isAttending(m.id)}
          {@const a = day.attendees.find((x) => x.memberId === m.id)}
          <div class="ml-6 flex flex-col gap-1.5 sm:flex-row sm:items-end">
            <TextField
              label="Home time"
              type="time"
              value={a?.homeTime ?? ''}
              onValueChange={(v) => onAttendeeHomeTime(m.id, v === '' ? null : v)}
              data-testid={`${testid}-time-${m.id}`}
            />
            <TextField
              label="Note"
              placeholder="e.g. make a portion for tomorrow"
              value={a?.note ?? ''}
              onValueChange={(v) => onAttendeeNote(m.id, v)}
              class="flex-1"
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
        <span class="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold"
            aria-hidden="true">{memberInitials(memberName(a.memberId) ?? '?')}</span
          >
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
  </fieldset>
</div>
