<script lang="ts">
  import { Thermometer, ThermometerSun, Droplets, Cloud, Umbrella } from '@lucide/svelte';
  import {
    temperatureBand,
    classifyEatingMood,
    type TemperatureBand,
    type EatingMood,
  } from '@salt/domain';
  import type { WeatherDaySummary } from '@salt/domain/schemas';

  // Compact, glanceable evening-forecast cue for one in-window planner day (issue
  // #382, Phase 3). The PARENT gates rendering — this component is only mounted for
  // concrete dated days inside the forecast window (it is never given a template
  // weekday). All POLICY (heat bands, eat-mood) lives in the pure domain
  // (temperatureBand / classifyEatingMood); this view only maps the returned enum
  // to a glyph/label/colour-class (CLAUDE.md Rule 1).
  interface Props {
    weather: WeatherDaySummary;
    testid?: string;
  }
  let { weather, testid }: Props = $props();

  // The colour is driven by the window HIGH — the warmest, most salient part of the
  // evening window (documented in temperatureBand). cool blues → warm oranges/reds.
  const band = $derived<TemperatureBand>(temperatureBand(weather.tempHigh));
  const BAND_CLASS: Record<TemperatureBand, string> = {
    freezing: 'text-sky-600',
    cold: 'text-sky-500',
    cool: 'text-cyan-600',
    mild: 'text-emerald-600',
    warm: 'text-orange-500',
    hot: 'text-red-600',
  };

  // The eat-mood cue: glyph + short label. Domain decides the mood; the view only
  // picks the presentation.
  const mood = $derived<EatingMood>(classifyEatingMood(weather));
  const MOOD_PRESENTATION: Record<EatingMood, { glyph: string; label: string }> = {
    'hot-comfort': { glyph: '🍲', label: 'Comfort food' },
    neutral: { glyph: '🍽️', label: 'Anything goes' },
    'cold-fresh': { glyph: '🥗', label: 'Fresh & light' },
  };
</script>

<div
  class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
  data-testid={testid}
>
  <!-- Temperature range — heat-coloured by the window high. -->
  <span
    class="flex items-center gap-1 font-medium {BAND_CLASS[band]}"
    title="Evening temperature high / low"
    data-testid={testid ? `${testid}-temp` : undefined}
  >
    <Thermometer class="h-3.5 w-3.5" aria-hidden="true" />
    <span class="tabular-nums">{weather.tempHigh}° / {weather.tempLow}°</span>
  </span>

  <!-- Feels like (apparent temperature). -->
  <span class="flex items-center gap-1" title="Feels like">
    <ThermometerSun class="h-3.5 w-3.5" aria-hidden="true" />
    <span class="tabular-nums">{weather.apparentTemp}°</span>
  </span>

  <!-- Humidity. -->
  <span class="flex items-center gap-1" title="Humidity">
    <Droplets class="h-3.5 w-3.5" aria-hidden="true" />
    <span class="tabular-nums">{weather.humidity}%</span>
  </span>

  <!-- Cloud cover. -->
  <span class="flex items-center gap-1" title="Cloud cover">
    <Cloud class="h-3.5 w-3.5" aria-hidden="true" />
    <span class="tabular-nums">{weather.cloudCover}%</span>
  </span>

  <!-- Rain chance (precipitation probability). -->
  <span class="flex items-center gap-1" title="Chance of rain">
    <Umbrella class="h-3.5 w-3.5" aria-hidden="true" />
    <span class="tabular-nums">{weather.precipitationChance}%</span>
  </span>

  <!-- Eat-mood cue. -->
  <span
    class="flex items-center gap-1 text-foreground"
    title="Suggested mood for the evening meal"
    data-testid={testid ? `${testid}-mood` : undefined}
  >
    <span aria-hidden="true">{MOOD_PRESENTATION[mood].glyph}</span>
    <span>{MOOD_PRESENTATION[mood].label}</span>
  </span>
</div>
