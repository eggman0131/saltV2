<script lang="ts">
  // The way into "Kitchen" (`/mine`) and, since #828, the ONLY way in: the personal
  // view left both nav lists, so this link is its single entry point at every
  // breakpoint. It therefore shows at every width, phones included — the header
  // that used to spend this space telling you your own email address now spends it
  // on the one destination that has nowhere else to be.
  //
  // Its own component rather than markup inline in App.svelte's `actions` snippet
  // only so it can be rendered on its own under test: App boots fifteen Firestore
  // subscriptions, and none of them bear on what this link says, where it points
  // or when it counts. Nothing beyond the link lives here.
  import { kitchenLabel } from '../lib/membersService.js';
  import { mineOpenCount } from '../lib/personalViewService.js';

  // The count rode on the Kitchen nav tab until #828 and means exactly what it
  // meant there — what is OPEN right now: my open cooks plus the timers that have
  // fired and nobody has dismissed (issues #634, #682). Only its location moved.
  //
  // Deliberately not "changed since you last looked": that needs a per-user
  // lastSeenAt, which means browser storage (Rule 3) or a fourth per-user
  // collection, and it lies across devices. A live count needs no memory,
  // self-clears when you fix the thing, and is honest on a cold launch. The
  // needs-review queue is excluded — it is a standing queue, so counting it would
  // pin a permanent number to the chrome. A timer still counting down is excluded
  // too: it is running to plan and wants no hand.
  //
  // It follows the link rather than being dropped because a fired timer is the one
  // genuine summons in the app; with no count in the chrome it would announce
  // itself nowhere, and you would only find out by opening the page.

  // The badge is a bare numeral, so it must not be the link's only carrier of
  // meaning: the count goes into the accessible name in words, and the numeral is
  // hidden from the accessibility tree. This mirrors what the nav tab did
  // structurally rather than visually — BottomNav built its own equivalent inside
  // the primitive, and there is no shared helper to reuse.
  const accessibleName = $derived(
    $mineOpenCount > 0
      ? `${$kitchenLabel}, ${$mineOpenCount} ${$mineOpenCount === 1 ? 'needs' : 'need'} attention`
      : $kitchenLabel,
  );
</script>

<!-- No text colour of its own: TopBar's surface is swapped wholesale for the
     non-prod environment banner, and everything in the bar inherits that surface's
     colour (see TopBar.svelte). A fixed `text-muted-foreground` — what the email
     span carried — would read as low-contrast against it. -->
<a
  href="#/mine"
  data-testid="kitchen-link"
  aria-label={accessibleName}
  class="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
>
  {$kitchenLabel}
  {#if $mineOpenCount > 0}
    <!-- SideNav's badge class string, verbatim (SideNav.svelte). @salt/ui-components
         exports no Badge primitive, and ui-spec-v02 §1 forbids implementing one that
         no spec defines — so this is a copy by instruction, not by oversight. -->
    <span
      data-testid="kitchen-link-badge"
      aria-hidden="true"
      class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground"
    >
      {$mineOpenCount}
    </span>
  {/if}
</a>
