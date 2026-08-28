<!-- spec: ui-spec-v12.md §8.30 v0.12 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import CanonIcon from '../CanonIcon/CanonIcon.svelte';
  import type { PictogramPillProps } from './PictogramPill.types';

  let { label, thumbnail, version, class: className, ...rest }: PictogramPillProps = $props();

  // The same render boundary `CanonIcon` applies to its own tile, repeated here
  // rather than delegated because the pill must know whether there is a picture
  // BEFORE it can pick its left padding (§8.30.4) — and because a miss must
  // render no tile at all, where `CanonIcon` alone would draw its bare
  // placeholder square. Keep the two in sync if the `"hidden"` sentinel or the
  // rule changes; `ui-components` is external-only and cannot import
  // `@salt/domain`'s `isCanonIconRenderable` (§8.30.5).
  const hasPicture = $derived(thumbnail != null && thumbnail !== 'hidden' && thumbnail.length > 0);
</script>

<span
  class={cn(
    // `inline-flex`, not `flex`: every other static pill in the package
    // (`.salt-chip--fact` et al., salt.css:730-736) is inline-level, and a
    // block-level pill stretches to fill any non-flex parent it lands in —
    // exactly what a plain wrapping `<div>`/`<p>` around it is. The caller
    // still owns not letting it stretch or shrink inside a flex row of its
    // own (`shrink-0 max-w-full`, §8.30.3).
    'inline-flex items-center gap-2 rounded-full border border-dashed bg-card py-1 pr-4 text-base',
    // 4px sets the round tile flush in the pill's round end, so the picture
    // reads as the end of the pill; with no tile the words fall back to the
    // pill's normal 16px inset (§8.30.4).
    hasPicture ? 'pl-1' : 'pl-4',
    className,
  )}
  {...rest}
>
  {#if hasPicture}
    <!-- Decorative: the label span below is the accessible name. Silenced two
         ways — an empty `name` (so `CanonIcon`'s `<img alt>` is `""`) and
         `aria-hidden` on the wrapper — so a screen reader announces the
         object once, not twice (§8.30.6). The per-step kit row
         (RecipeViewPage.svelte) already did this by hand; this makes it the
         primitive's own behaviour so no caller has to remember. -->
    <span aria-hidden="true">
      <CanonIcon thumbnail={thumbnail ?? null} {version} name="" size={40} class="rounded-full" />
    </span>
  {/if}
  <span class="min-w-0 break-words">{label}</span>
</span>
