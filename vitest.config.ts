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
      // Numbers are EXACT measurements with ONE stated exception. Repeat runs on
      // one machine are byte-identical, and seven of the eight areas below also
      // measure identically on macOS and on CI's ubuntu-latest — same figure to
      // the last decimal, both metrics. So they carry no margin: a margin would
      // only buy room for a real regression to hide in.
      //
      // `apps/web-pwa/src/lib/**` is the exception and is pinned ONE LINE and ONE
      // BRANCH below the worse of the two platforms (lines 67.48 → 67.44,
      // branches 60.99 → 60.93). Two timing-sensitive modules in that directory —
      // `deck.svelte.ts` and `savedTick.svelte.ts` — land differently under CI's
      // slower scheduler, and the entire cross-platform delta in the repo is
      // those two files: one branch and one line, nothing else. The headroom is
      // sized at exactly that wobble, computed rather than guessed. It is three
      // orders of magnitude smaller than a real regression (removing one
      // firebase-sync test file moved that area 5.22pp), so the ratchet still
      // bites. Fixing the underlying non-determinism is #967; when that lands,
      // this pin goes back to the measured figure and the headroom goes away.
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
        'packages/adapters/observability/src/**': { lines: 83.56, branches: 77.77 },
        'packages/adapters/firebase-sync/src/**': { lines: 57.82, branches: 63.02 },
        'apps/cloud-functions/src/**': { lines: 79.75, branches: 73.73 },
        'apps/web-pwa/src/routes/**': { lines: 73.91, branches: 63.24 },
        // The one pin with headroom — see the note above.
        'apps/web-pwa/src/lib/**': { lines: 67.44, branches: 60.93 },
        'apps/web-pwa/src/components/**': { lines: 50.86, branches: 37.67 },
      },
    },
  },
});
