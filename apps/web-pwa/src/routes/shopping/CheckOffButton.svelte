<!--
  The shopping list's check-off circle, shared by the plain row and the combined
  row so the celebration has exactly one implementation.

  Three states, one control:
   - unchecked  → an outline circle
   - exiting    → a filled sage disc with a white check springing into place
   - checked    → the settled CircleCheck (what the Checked section shows)

  `exiting` is the hold the page owns (`createCheckOffHold`), NOT this button's
  own state: by the time the disc pops, the Firestore write has already gone. The
  sage is `--salt-secondary`, the brand green — the prototype's green-600 was a
  Tailwind default, not a Salt colour.
-->
<script lang="ts">
  import { Icon } from '@salt/ui-components';
  import { tick as hapticTick } from '../../lib/haptics.js';

  interface Props {
    /** The item's settled checked state. Combined rows pass `false` — they only ever check. */
    checked: boolean;
    /** True while the row is held open playing its check-off celebration. */
    exiting?: boolean;
    onSelect: () => void;
  }

  let { checked, exiting = false, onSelect }: Props = $props();

  function handleClick(): void {
    // The tick belongs to the PRESS, so it fires before the work the press starts
    // — and only on the way in. Unchecking is undoing a mistake, not an
    // accomplishment: no tick, and (in the page) no hold either.
    if (!checked) hapticTick();
    onSelect();
  }
</script>

<button
  type="button"
  class="salt-press-pulse flex items-center justify-center rounded p-1 transition-[color,transform] duration-fast ease-standard motion-reduce:transition-none {checked ||
  exiting
    ? 'text-secondary'
    : 'text-muted-foreground hover:text-foreground'}"
  onclick={handleClick}
  aria-label={checked ? 'Uncheck' : 'Mark as done'}
  data-testid="shopping-item-check"
>
  {#if exiting}
    <span
      class="salt-check-pop motion-reduce:animate-none flex h-[18px] w-[18px] items-center justify-center rounded-full bg-secondary text-secondary-foreground"
    >
      <Icon name="Check" size={12} />
    </span>
  {:else}
    <Icon name={checked ? 'CircleCheck' : 'Circle'} size={18} />
  {/if}
</button>
