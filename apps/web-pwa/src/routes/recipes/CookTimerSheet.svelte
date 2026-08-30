<script lang="ts">
  import { untrack } from 'svelte';
  import {
    Button,
    Icon,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    TextField,
  } from '@salt/ui-components';
  import { parseMinutes, stepMinutesDown, stepMinutesUp } from './cookTimerDuration.js';

  // The cook timer sheet (issue #748) — ONE sheet for all four ways a timer gets
  // its name and its length: a step timer before it starts, that same step timer
  // with the duration changed, a timer already counting down, and a timer for
  // something the recipe never mentioned. The caller decides which by what it
  // prefills; nothing in here knows the difference except the button's wording.
  //
  // It knows nothing about ids, steps or sessions either: it takes a name and a
  // number and hands back a name and a number. Minting the id, computing `endsAt`
  // and writing the session all stay with the page, which is where the clock and
  // the session snapshot already live.

  interface Props {
    open: boolean;
    /** Re-read every time the sheet opens, so a step timer re-offers its own
     *  duration on each visit — which is why there is no "reset" control. */
    prefill: { label: string; durationMinutes: number };
    /** Copy only. Re-timing a countdown that is already running is the same
     *  operation as starting one; the button just stops pretending otherwise. */
    running?: boolean;
    onConfirm: (timer: { label: string; durationMinutes: number }) => void;
  }
  let { open = $bindable(), prefill, running = false, onConfirm }: Props = $props();

  // Seeded from the prefill once, then owned by the fields; the open-effect below
  // re-seeds on every subsequent open. `untrack` because that first read is a
  // starting value, not a subscription — the prop changing while the sheet is shut
  // must not reach in and rewrite what the cook has typed.
  let label = $state(untrack(() => prefill.label));
  // The typed text, not a number: it is the same field the chips write into, and
  // a half-typed "" or "3x" has to be REPRESENTABLE while the cook is still
  // typing. `minutes` is the parse of it, and null is what disables the start.
  let minutesText = $state(untrack(() => String(prefill.durationMinutes)));
  const minutes = $derived(parseMinutes(minutesText));

  // Re-seed on each open (the planner sheet's pattern): the sheet is mounted for
  // the life of the page, so without this the second timer would open holding the
  // first one's name.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      label = prefill.label;
      minutesText = String(prefill.durationMinutes);
    }
    wasOpen = open;
  });

  function confirm(): void {
    if (minutes === null) return;
    onConfirm({ label: label.trim(), durationMinutes: minutes });
    open = false;
  }
</script>

<Sheet bind:open side="bottom">
  <SheetContent class="flex flex-col gap-4">
    <SheetHeader>
      <!-- Always present: `aria-labelledby` on the dialog points at it (ui-spec-v03
           §5.5), so a sheet without one announces as an unnamed modal. -->
      <SheetTitle>{running ? 'Adjust timer' : 'Set a timer'}</SheetTitle>
    </SheetHeader>

    <div class="mx-auto flex w-full max-w-sm flex-col gap-4">
      <!-- The name leads, as it does on the chip this will become. No visible
           label: the placeholder plus the sheet's own title already say what it
           is, and a cook holding a phone one-handed gets one more line of thumb
           room. `aria-label` carries the name for anyone not reading it. -->
      <TextField
        bind:value={label}
        aria-label="Timer name"
        placeholder="Timer name"
        data-testid="cook-timer-sheet-name"
      />

      <!-- Duration. Chips either side of the number, the shape the servings
           stepper already uses on the add-to-list sheet — and the number itself
           is the field, so a big change is typed rather than tapped out. -->
      <div class="flex items-center justify-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onclick={() => (minutesText = String(stepMinutesDown(minutes ?? 1)))}
          disabled={minutes === null}
          aria-label="Decrease minutes"
          data-testid="cook-timer-sheet-decrease"
        >
          <Icon name="Minus" size={14} />
        </Button>
        <TextField
          bind:value={minutesText}
          inputmode="numeric"
          aria-label="Minutes"
          class="w-32"
          error={minutes === null ? 'Whole minutes, 1 or more.' : undefined}
          data-testid="cook-timer-sheet-minutes"
        >
          {#snippet trailing()}
            <span class="shrink-0 text-sm text-muted-foreground">min</span>
          {/snippet}
        </TextField>
        <Button
          variant="outline"
          size="sm"
          onclick={() => (minutesText = String(stepMinutesUp(minutes ?? 1)))}
          disabled={minutes === null}
          aria-label="Increase minutes"
          data-testid="cook-timer-sheet-increase"
        >
          <Icon name="Plus" size={14} />
        </Button>
      </div>
    </div>

    <SheetFooter class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => (open = false)}>Cancel</Button>
      <!-- Same operation either way, honest copy either way: a running timer is
           re-timed through the same write that started it. -->
      <Button
        size="sm"
        onclick={confirm}
        disabled={minutes === null}
        data-testid="cook-timer-sheet-confirm"
      >
        {#snippet leading()}<Icon name="Timer" size={16} />{/snippet}
        {running ? 'Update timer' : 'Start timer'}
      </Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
