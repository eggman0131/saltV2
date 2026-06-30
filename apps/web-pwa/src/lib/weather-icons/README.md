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

After background removal each icon is run through a weather-only framing pass
(`scripts/lib/normalizeIconFraming.mjs`): the model centres its subject only
loosely, so without it the set renders at mismatched apparent sizes. The pass
trims to the subject's alpha box, scales its longer side to a fixed target, and
re-pads it dead-centre in the 128px square — so all 17 share one bounding size
and uniform margins (their differing short-axis extents are the real shapes:
a wide overcast cloud vs. a tall heavy-rain). To re-frame the committed assets
in place without regenerating via AI, run
`node scripts/normalize-weather-icons.mjs` from `apps/cloud-functions`.

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
