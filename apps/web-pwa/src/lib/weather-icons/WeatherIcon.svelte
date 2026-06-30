<script lang="ts">
  import type { WeatherIconId } from '@salt/domain';
  import { weatherIconUrl } from '$lib/weather-icons';

  // Thin, purely-presentational <img> wrapper for the fixed weather-icon set
  // (issue #387). Mirrors the CanonIcon pattern: it owns no policy, takes a
  // resolved icon id, and renders NOTHING when there's no icon — so callers can
  // pass `null` for past/out-of-window/template days and get graceful absence
  // (no placeholder box). The icons are pastel raster art consumed as-is; this
  // component never recolours them. Sizing/opacity/positioning are entirely the
  // caller's job via the `class` passthrough — here it is used as a faint,
  // decorative watermark behind the planner day header.
  interface Props {
    icon: WeatherIconId | null | undefined;
    class?: string;
  }
  let { icon, class: className = '' }: Props = $props();

  const url = $derived(weatherIconUrl(icon));
</script>

{#if url}
  <img
    src={url}
    alt=""
    aria-hidden="true"
    draggable="false"
    loading="lazy"
    decoding="async"
    class={`pointer-events-none select-none object-contain ${className}`}
    data-testid="weather-icon-img"
  />
{/if}
