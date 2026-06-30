# Weather icons (issue #387)

A FIXED set of 17 weather pictograms for the meal-planner forecast. They share
the canon-icon house style (thick rounded dark outline, soft pastel palette,
plain off-white background, app-sticker look) but are small composite scenes
(sun behind a cloud, cloud with rain streaks, moon with stars) rather than the
single centred subject the grocery canon icons use.

## How they are made

Offline, one-off, by reusing the existing canon-icon AI pipeline. See
`apps/cloud-functions/scripts/generate-weather-icons.mjs` (run under `tsx`). The
prompt wording lives in `apps/cloud-functions/src/flows/weatherIconPrompt.ts`
and reuses the locked canon `STYLE` string. Generation is NOT a runtime path —
the planner renders the committed static `.webp` files in this directory.

The id set is the single source of truth in
`packages/domain/src/weather/weatherIcon.ts` (`WeatherIconId`); `weatherIcon()`
maps a WMO code (+ day/night) to one of these ids.

## The 17 filenames (one WebP per id)

```
clear-day.webp           clear-night.webp
mostly-clear-day.webp    mostly-clear-night.webp
partly-cloudy-day.webp   partly-cloudy-night.webp
overcast.webp
fog.webp
drizzle.webp
rain-light.webp          rain-heavy.webp
showers-day.webp         showers-night.webp
sleet.webp
snow-light.webp          snow-heavy.webp
thunder.webp
```

Day/night pairs exist only for `clear`, `mostly-clear`, `partly-cloudy`, and
`showers`.

## Planned: id → asset-URL map (NOT yet created)

A later step (after the human style checkpoint, once the real `.webp` assets are
committed) adds an `id → URL` map in this directory — Vite-bundled URL imports
(`import clearDay from './clear-day.webp'`) keyed by `WeatherIconId` and typed
`Record<WeatherIconId, string>`. It is deliberately omitted now: importing
`.webp` files that don't exist yet would not typecheck/build. The view layer
will consume that map; it never decides the WMO→id mapping (that policy stays in
`@salt/domain`).
