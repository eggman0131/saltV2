import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every project sets `pool: 'threads'` (see any project config for why).
    // It is a PROJECT-level option — setting it in this root `test` block is
    // silently ignored when `projects` is used, and `extends` here would re-root
    // each project and break its `include` globs. So it lives in the 8 configs.
    projects: [
      'packages/shared-types/vitest.config.ts',
      'packages/domain/vitest.config.ts',
      'packages/adapters/firebase-sync/vitest.config.ts',
      'packages/adapters/observability/vitest.config.ts',
      'packages/ui-components/vitest.config.ts',
      'apps/web-pwa/vitest.config.ts',
      'apps/cloud-functions/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/unit',
      include: ['packages/*/src/**', 'packages/adapters/*/src/**', 'apps/*/src/**'],
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
      // Areas deliberately unfloored: `packages/shared-types/src` (4 covered
      // lines in total — a pin there is noise, not a signal) and the storybook
      // stories that `include` sweeps up (dev-only, never unit-tested).
      //
      // NOTE for the two Svelte-bearing areas below (`apps/web-pwa/src/routes`,
      // `apps/web-pwa/src/components`; `packages/ui-components/src` likewise):
      // v8 measures the COMPILED output of a `.svelte` file, not its source, so
      // the absolute percentage is approximate and should not be read as "how
      // much of this component is tested". The DELTA is still exact and still a
      // valid ratchet — the same compiler runs on both sides of a change.
      thresholds: {
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
        'apps/web-pwa/src/routes/**': { lines: 73.91, branches: 63.24 },
        'apps/web-pwa/src/lib/**': { lines: 71.44, branches: 63.91 },
        'apps/web-pwa/src/components/**': { lines: 50.86, branches: 37.67 },
      },
    },
  },
});
