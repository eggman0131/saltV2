<!-- spec: canon-icons.md §Rendering v1.0 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import type { CanonIconProps } from './CanonIcon.types';

  let {
    thumbnail,
    name = '',
    size = 30,
    dimmed = false,
    version,
    matched = false,
    shimmer = false,
    class: className,
  }: CanonIconProps = $props();

  // Tri-state render boundary. This mirrors @salt/domain's
  // `isCanonIconRenderable`; ui-components cannot import @salt/domain
  // (external-only per the layer map), so the logic is duplicated here as the
  // single render boundary. Keep the two in sync if the `"hidden"` sentinel or
  // the rule changes.
  const renderable = $derived(thumbnail !== null && thumbnail !== 'hidden' && thumbnail.length > 0);

  // Display-time cache-bust. A regenerated icon reuses the same (byte-identical)
  // Storage download URL, so the browser serves the stale image; appending a
  // per-regeneration `?v=`/`&v=` nonce forces a re-fetch. Only applied when the
  // icon is renderable (never to `null`/`"hidden"`) and a non-empty `version` is
  // present (an empty version carries no cache-key info); otherwise the raw URL
  // passes through unchanged. Behaviourally identical to @salt/domain's
  // `appendCacheBuster`; the `?`/`&`-aware join is inlined here because
  // ui-components is external-only and cannot import a @salt/domain helper (same
  // reason `isCanonIconRenderable` is duplicated).
  const bustedSrc = $derived(
    renderable && thumbnail !== null && version != null && version !== ''
      ? `${thumbnail}${thumbnail.includes('?') ? '&' : '?'}v=${version}`
      : thumbnail,
  );

  // The sage "found its home" tint applies only to a BARE matched tile — a tile
  // that already renders an icon keeps its neutral `bg-icon-tile` backdrop, so
  // matched icons across the app are visually untouched. The first letter fills
  // the otherwise-empty sage square; empty when there is no name.
  //
  // Sage is the "lit up" state the reveal produces, so it is gated with the reveal:
  // under reduced motion the bare matched tile stays grey with no letter — exactly
  // today's appearance — via `motion-reduce:` overrides (the sage colour never
  // animates then either, `transition-colors` being `motion-reduce:transition-none`).
  const sageBare = $derived(matched && !renderable);
  const initial = $derived(name.trim().charAt(0).toUpperCase());
</script>

<span
  class={cn(
    'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded transition-colors motion-reduce:transition-none',
    sageBare ? 'bg-secondary-container motion-reduce:bg-icon-tile' : 'bg-icon-tile',
    dimmed && 'opacity-40',
    className,
  )}
  style="width: {size}px; height: {size}px;"
  data-testid="canon-icon"
>
  {#if renderable}
    <img
      src={bustedSrc}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      class="h-full w-full object-contain"
      data-testid="canon-icon-img"
    />
  {:else if sageBare && initial}
    <span
      class="pointer-events-none select-none font-semibold leading-none text-accent-foreground motion-reduce:hidden"
      style="font-size: {Math.round(size * 0.5)}px;"
      aria-hidden="true"
      data-testid="canon-icon-initial">{initial}</span
    >
  {/if}
  {#if shimmer}
    <span
      class="salt-icon-shimmer pointer-events-none absolute inset-0 motion-reduce:hidden"
      aria-hidden="true"
      data-testid="canon-icon-shimmer"
    ></span>
  {/if}
</span>
