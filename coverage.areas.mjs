// The coverage AREAS: which files the unit-test coverage report measures, and
// what floor each group of them carries. Consumed by `vitest.config.ts` (which
// measures) and by `scripts/check-coverage-files.mjs` (which proves the
// measurement reached every file named here).
//
// Declared once, in plain ESM, because two copies would drift — and a drifted
// copy is worse than no check at all: it would report "stable" while the floors
// moved underneath it.

// ---------------------------------------------------------------------------
// Which files
// ---------------------------------------------------------------------------
// EXTENSIONS ARE NAMED, and that is load-bearing (issue #974). Vitest 4 dropped
// `coverage.extension` and defaults `coverage.exclude` to `[]`, so a bare
// `src/**` sweeps up every file that happens to live under a `src/` — not just
// the code. In this repo that was 18 `.webp` weather icons, three `.css` files
// and a `README.md`, none of which can carry a line of coverage:
//
//   - the images and stylesheets carry no executable line at all, so they moved
//     no percentage — they merely sat in the file set as measured "source" that
//     could never be covered, inflating every per-area count and the HTML report
//     with 21 rows of nothing. Harmless to the floors, fatal to being able to
//     state what the floors are computed over;
//   - `apps/web-pwa/src/lib/weather-icons/README.md` is the one that was not
//     harmless: markdown handed to a JavaScript parser fails, and a file that
//     fails to parse is dropped from the report entirely (see the guard
//     script's header for what "dropped" costs).
//
// `.ts` and `.svelte` are the only two extensions any measured area contains.
// Add one here when a third appears — do not widen back to a bare `src/**`.
export const coverageInclude = [
  'packages/*/src/**/*.{ts,svelte}',
  'packages/adapters/*/src/**/*.{ts,svelte}',
  'apps/*/src/**/*.{ts,svelte}',
];

// `apps/storybook` is the one `apps/*/src` tree with NO vitest project, and
// that is what makes it unmeasurable rather than merely untested (issue #974).
// Coverage transforms an untested file through the vite server of whichever
// project owns it; with no project of its own, storybook falls through to the
// ROOT project, whose vite config carries no `@sveltejs/vite-plugin-svelte`. So
// all 36 `stories/_wrappers/*.svelte` were read as raw Svelte, handed to a
// JavaScript parser, and dropped — 36 of the 37 parse failures on every run.
//
// Excluding them is narrow and costs nothing measurable: Storybook is dev-only
// (CLAUDE.md's layer map — typecheck + check in CI, no build, no e2e), nothing
// unit-tests it, and it matches none of the area globs below, so no floor moves.
// The alternative — giving storybook a vitest project purely so its demo
// wrappers could be reported at 0% — would add a project with no tests in it.
export const coverageExclude = ['apps/storybook/src/**'];

// ---------------------------------------------------------------------------
// What floor each area carries
// ---------------------------------------------------------------------------
// Per-area coverage RATCHET (issue #943; the baseline it descends from is
// recorded in the #941 sub-epic, which measured the whole suite).
//
// These are floors meaning "do not go backwards", NOT targets. Nothing
// here says 57.82% is acceptable for firebase-sync — it says the refactor
// programme in #913 must not make it 57.81%. Raising a pin after coverage
// genuinely improves is a deliberate, separate act; never lower one to get
// a PR green.
//
// PER-AREA and not one global number, because a global number is the exact
// failure mode this guards against: `domain` at 98.74% over 291 files would
// comfortably absorb `firebase-sync` at 57.82% rotting further, and
// firebase-sync is where #928, #931 and #939 all land. Each area carries
// its own floor so a regression is attributed to the area that caused it —
// vitest names the matched glob in the failure message.
//
// Numbers are EXACT measurements. Repeat runs on one machine are
// byte-identical, and every area below measures identically on macOS and on
// CI's ubuntu-latest — same figure to the last decimal, both metrics. So
// they carry NO margin: a margin would only buy room for a real regression
// to hide in.
//
// `apps/web-pwa/src/lib/**` used to be the exception, pinned one line and
// one branch low because `deck.svelte.ts` and `savedTick.svelte.ts` landed
// differently under CI's scheduler — the whole cross-platform delta in the
// repo was those two files. Both were tests waiting on host timing rather
// than driving it, and #967 fixed them at the source: `savedTick`'s 1.5 s
// clear is now advanced with fake timers instead of outlived, and the
// planner's day sheet waits for bits-ui to take focus before anything is
// typed, so an Escape meant for the dialog can no longer be dispatched from
// the deck row underneath it. The headroom went with them.
//
// Re-pinning it at TODAY's measurement also banks the coverage that area has
// earned since #943 measured it (67.51/60.99 on 2026-08-24 → 71.44/63.91),
// which is a raise and therefore deliberate: leaving the pin at the older
// figure would hand back four points of hiding room to close a gap of four
// hundredths, which is the opposite of what the ratchet is for.
//
// Both web-pwa pins were then re-measured for #994, which moved well-covered
// code ACROSS the two globs — the cook lifecycle, the timers, the step deck
// and the ingredient rows left `src/routes/**` for `src/lib/**` — and lifted
// both (73.91/63.24 → 76.08/64.12 and 71.44/63.91 → 73.37/65.6). Measured
// once on the finished branch, deliberately not per phase: mid-refactor the
// two globs are in motion against each other, so a per-phase re-pin banks a
// number that the next phase invalidates.
//
// UNCHANGED by #974, which is the point of it. That issue narrowed the measured
// FILE SET — 21 assets out, 36 unparseable storybook wrappers out — without
// moving a single figure below: the assets carried no executable line, and the
// wrappers had never reached the report in the first place, having failed to
// parse. Measured both ways over the full suite, every area reports identically
// to the last decimal. A measurement repair that moved a floor would have been
// the bug, not the fix.
//
// Areas deliberately unfloored: `packages/shared-types/src` (4 covered
// lines in total — a pin there is noise, not a signal) and `apps/storybook`,
// which is excluded from measurement outright (see `coverageExclude`).
//
// NOTE for the two Svelte-bearing areas below (`apps/web-pwa/src/routes`,
// `apps/web-pwa/src/components`; `packages/ui-components/src` likewise):
// v8 measures the COMPILED output of a `.svelte` file, not its source, so
// the absolute percentage is approximate and should not be read as "how
// much of this component is tested". The DELTA is still exact and still a
// valid ratchet — the same compiler runs on both sides of a change.
export const coverageThresholds = {
  'packages/domain/src/**': { lines: 98.74, branches: 91.64 },
  'packages/ui-components/src/**': { lines: 88.03, branches: 74.74 },
  // Lines CORRECTED DOWN 83.56 → 82.58 in #977, and this is the one case
  // where that is not a ratchet release. 83.56 was never measured: it was
  // the output of a corrupted v8 merge. `browserTracer.ts` loads its OTel
  // implementation with a fire-and-forget `import()`, and seven tests left
  // that load in flight at worker teardown, so V8 reported
  // `browserTracerImpl.ts` a second time with every count at zero. Merging
  // that entry misaligned the statement maps and credited five lines that
  // CANNOT have run — including the `pagehide` registration, inside a guard
  // this project's `node` environment sends the other way. Whether the race
  // was lost decided whether the pin was met, hence cold-cache red / warm
  // green. Draining the load (observability's tests/setup.ts) makes the
  // measurement identical cold and warm; 82.58% is what it has always
  // honestly been. Branches gained the same way (77.78 → a true 78.59) and
  // the pin is left at 77.77 rather than swept up in the correction —
  // raising a pin stays a deliberate, separate act.
  'packages/adapters/observability/src/**': { lines: 82.58, branches: 77.77 },
  'packages/adapters/firebase-sync/src/**': { lines: 57.82, branches: 63.02 },
  'apps/cloud-functions/src/**': { lines: 79.75, branches: 73.73 },
  'apps/web-pwa/src/routes/**': { lines: 76.08, branches: 64.12 },
  'apps/web-pwa/src/lib/**': { lines: 73.37, branches: 65.6 },
  'apps/web-pwa/src/components/**': { lines: 50.86, branches: 37.67 },
};

/** The area globs, in the order the ratchet declares them. */
export const coverageAreas = Object.keys(coverageThresholds);
