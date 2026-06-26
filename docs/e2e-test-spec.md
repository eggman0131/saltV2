# Playwright E2E — Non-Functional Specification

This is the **stability contract** for the Playwright suite in
[`apps/web-pwa/e2e/`](../apps/web-pwa/e2e/). It is a _non-functional_ spec: it does not say what a
test should assert (that is the test's job), it says what qualities every test must have to be
**deterministic, isolated, and diagnosable**. The mechanics of the emulator stacks, ports, and CI
wiring live in [docs/e2e.md](e2e.md); this document is the **pre-review gate** applied on top of it.

**How to use it.** Apply this checklist to any new or changed spec _before_ a functional review of
what it asserts. A spec that fails a `MUST` is not ready for review. The condensed
[Reviewer checklist](#reviewer-checklist) at the end is the fast path; the numbered requirements
below are the rationale and the verification recipe for each line.

**Why this exists.** The suite went flaky immediately after the #297 coverage rebalance, which added
the three categories that are intrinsically hardest to stabilise — realtime cross-tab convergence,
AI/Cloud-Function trigger pipelines, and multi-tab owner-scoping. A "range of different tests fail,
they pass on retry" signature is the fingerprint of races in exactly those categories (and of a
[poisoned environment](#h-environment-vs-code-triage), which is _not_ a code defect). These rules
target that signature directly.

**Conventions.** Each requirement is `MUST` (a green-light blocker) or `SHOULD` (justify a
deviation in the PR). IDs are stable (`NF-A1` …) so reviews and follow-ups can cite them.

---

## A. Async settling & determinism

The app's observable state lands **after** an async round-trip — Firestore persistence, an
`onSnapshot` delivery, or a Cloud Function trigger rewrite. Every wait must be tied to that concrete
event, never to wall-clock time.

- **NF-A1 (MUST) — No arbitrary sleeps as a substitute for settling.** Do not use
  `page.waitForTimeout(...)` to "give it time to load/save/sync." Wait on the real signal instead:
  a web-first assertion, `expect.poll`, `expect(...).toPass`, or a `waitForFunction` on the
  `window.__e2e` bridge.
  _Verify:_ `grep -n waitForTimeout` in the changed spec — every hit must satisfy NF-A2.

- **NF-A2 (MUST) — The only legal `waitForTimeout` is a bounded negative assertion.** A fixed hold
  is acceptable **only** to prove something _never_ happens (e.g. "user B must never receive user
  A's owner-scoped session"), and only when paired with a preceding `expect.poll` that already
  reached the steady state. See the canonical example at
  [chat.spec.ts:150-156](../apps/web-pwa/e2e/chat.spec.ts#L150-L156): poll to `length 0`, hold
  2 s, re-assert still `0`. Any other `waitForTimeout` is a defect. Add a one-line comment naming
  the negative property being held.

- **NF-A3 (MUST) — Assertions are web-first / retrying.** Use `await expect(locator)…` and
  `expect.poll(() => bridgeRead())`. Never assert on a one-shot read in the test flow:
  `locator.count()`, `.textContent()`, `.isVisible()`, or a bare `await getX()` compared with
  `expect(value)` is forbidden _as the settling step_ (a bare read is fine only as the second half
  of an NF-A2 negative hold, where the steady state is already established).
  _Verify:_ no `expect(await page.…())` / `expect(await getX())` used to _wait_ for state.

- **NF-A4 (MUST NOT) — No `networkidle` / `waitForLoadState` as a barrier.** The PWA holds open
  Firestore Listen streams, so the network is never idle; `networkidle` either
  hangs or resolves nondeterministically. Wait for a UI or bridge signal instead. (The suite is
  currently clean here — keep it that way.)

- **NF-A5 (SHOULD) — One convergence timeout vocabulary.** Reuse the established per-spec constants
  rather than inlining magic numbers: `SYNC_TIMEOUT = 15_000` (single-tab persistence /
  store settle), `CONVERGENCE_TIMEOUT = 20_000` (cross-tab `onSnapshot`),
  `TRIGGER_TIMEOUT = 30_000` (CF trigger rewrite), `HYDRATE_TIMEOUT = 30_000` (full reload +
  rehydrate). Picking a name documents _which_ async path you are waiting on.

---

## B. Locators

- **NF-B1 (MUST) — Accessible-first for content.** Resolve and assert content via
  `getByRole` / `getByLabel` / `getByText` / `getByPlaceholder`. Content assertions never key off
  DOM structure.

- **NF-B2 (SHOULD) — `data-testid` only on action affordances.** Per the authoring conventions in
  [docs/e2e.md](e2e.md#authoring-conventions), `getByTestId` is allowed for icon buttons, dialog
  containers, and drag handles — elements with no stable accessible name. It must not be used to
  dodge a missing role/label on _content_.

- **NF-B3 (MUST NOT) — No positional / structural locators for stable elements.** `nth(n)`, deep
  `>` CSS chains, and class-name selectors race against render order and break on markup tweaks.
  Disambiguate with `.filter({ hasText })` or a scoping `getByRole` region instead. `nth` is
  tolerable only over a set the test itself just created and whose order it controls — comment why.
  _Verify:_ audit `grep -nE "\.nth\(|locator\(['\"]" ` in the changed spec; each survivor needs a
  justification.

---

## C. Isolation & state

Isolation here is **structural**, not parallel-safe-by-design — and that distinction is load-bearing.

- **NF-C1 (MUST) — Respect the `workers: 1` ⇄ global-clear coupling.** The `clearFirestore` auto
  fixture ([fixtures/test.ts:39-48](../apps/web-pwa/e2e/fixtures/test.ts#L39-L48)) issues a
  **whole-database** `DELETE` against the emulator before every test. This is safe **only because
  [`playwright.config.ts`](../apps/web-pwa/playwright.config.ts) pins `workers: 1`.** Do **not**
  raise the worker count to speed the suite up: with >1 worker, each test's global wipe destroys
  every other in-flight test's data, manufacturing exactly the broad, retry-passing flake we are
  trying to kill. `fullyParallel: true` is currently a no-op given one worker; treat the effective
  concurrency as **serial**. Changing this is a deliberate isolation-model change — open an issue
  (per CLAUDE.md "issue-first"), and move to per-test data-scoped cleanup first.

- **NF-C2 (MUST) — Unique identity per test.** Derive user emails from
  `uniqueEmail(testInfo.testId)` ([helpers/auth.ts:4-6](../apps/web-pwa/e2e/helpers/auth.ts#L4-L6)).
  Never hard-code a shared `e2e@salt.test`. All Salt collections are family-shared (no user scoping),
  so per-test identity is the only thing separating owner-scoped data (e.g. chat sessions).

- **NF-C3 (MUST) — Self-contained; runnable in isolation, in any order.** No test may depend on
  state another test created. Seed everything you read. Given NF-C1's per-test global wipe, assuming
  leftover data is automatically a bug.

- **NF-C4 (MUST) — Seed through the real adapter, via the bridge.** Create fixtures with the
  `window.__e2e` helpers ([helpers/seed.ts](../apps/web-pwa/e2e/helpers/seed.ts)) so writes go
  through the real `@salt/firebase-sync` persistence path, not a side-channel. The one sanctioned
  REST back door is the **member allowlist** seed
  ([helpers/auth.ts:18-43](../apps/web-pwa/e2e/helpers/auth.ts#L18-L43)), because the
  `beforeMemberCreated` blocking function rejects sign-in for un-allowlisted emails — so the member
  doc must exist _before_ `devSignIn`. Preserve that ordering.

- **NF-C5 (MUST) — Fresh browser context per tab-scoped identity.** Default per-test context is the
  baseline. Multi-tab tests that model two users (`page1`/`page2`) MUST use separate
  `browser.newContext()` per user and close them in a `finally`
  (see [chat.spec.ts](../apps/web-pwa/e2e/chat.spec.ts)) — a shared context leaks auth/session state
  between the "two users" and silently invalidates owner-scoping assertions.

---

## D. Realtime & cross-tab convergence  _(Salt-specific)_

This is the category generic Playwright guidance does not cover, and the one most responsible for
post-#297 flake.

- **NF-D1 (MUST) — Settle the listener before you act on it.** The emulator's Listen transport is
  forced to **long-polling** (issues #122/#199), which can _drop_ an `onSnapshot` update that
  arrives mid-navigation. A reader tab MUST reach a known-synced state **before** the writer tab
  seeds. Use `waitForCanonReady(page)` / the `window.__e2e.isCanonSynced()` gate
  ([helpers/seed.ts:36-40](../apps/web-pwa/e2e/helpers/seed.ts#L36-L40)) on every reader tab before
  the write that it is expected to observe. See
  [canon-sync.spec.ts:59-60](../apps/web-pwa/e2e/canon-sync.spec.ts#L59-L60) for the pattern.
  _A cross-tab test with no settle gate before the seed is the prime flake suspect — flag it._

- **NF-D2 (MUST) — Assert convergence with `expect.poll`, scoped to `CONVERGENCE_TIMEOUT`.** Read
  the **destination** tab's store via a bridge getter inside `expect.poll`; never sleep-then-read.
  Cross-tab propagation over long-polling is legitimately slower than single-tab settle, so use the
  20 s `CONVERGENCE_TIMEOUT`, not `SYNC_TIMEOUT`.

- **NF-D3 (SHOULD) — Prefer the store snapshot over the DOM for convergence facts.** When the
  question is "did the data arrive," poll the bridge store (`getAisles`, `getSessions`, …); reserve
  DOM assertions for "did the UI render it." This sidesteps render-timing races layered on top of
  sync-timing races.

---

## E. AI & Cloud-Function trigger determinism  _(Salt-specific)_

AI flows are made deterministic by the `FUNCTIONS_AI_FAKE=1` fake-model seam (#297). The real
callable → trigger → Firestore pipeline still runs; only the model output is canned.

- **NF-E1 (MUST) — Stub before you fire.** `window.__e2e.stubAi(flow, response)` writes the canned
  answer to `_e2e_ai_stubs/{flow}`; the trigger reads it when it runs. Every `stubAi` for a flow
  MUST complete **before** the action that triggers that flow, or the CF runs against an absent stub
  and the assertion races. See the BEFORE-triggering note in
  [equipment-capture.spec.ts:10-11](../apps/web-pwa/e2e/equipment-capture.spec.ts#L10-L11) and the
  multi-stub round-trip in
  [ai-stub-smoke.spec.ts:51-56](../apps/web-pwa/e2e/ai-stub-smoke.spec.ts#L51-L56). When a flow
  fans into stages (identify → populate), stub **all** stages up front.

- **NF-E2 (MUST) — Assert the post-trigger observable state via the bridge, not the DOM mid-flight.**
  The trigger rewrite (canonId, matchState, rewritten rawText/amount/unit) is the thing under test;
  read it with `getShoppingListItems` / equivalent inside `expect.poll`/`toPass` scoped to
  `TRIGGER_TIMEOUT`. The DOM may render an optimistic intermediate state before the trigger lands —
  asserting on it is a race.

- **NF-E3 (SHOULD) — Keep canonicalisation on the deterministic exact-match path.** Where a test is
  about the _pipeline_ and not the _model_, seed canon that resolves by exact name (no AI branch),
  as #297 does, so the matched state is fully assertable without a second source of nondeterminism.

- **NF-E4 (MUST) — Never reach a live model.** No test may depend on a real Gemini call. If a flow
  has no stub seam yet, it is not e2e-testable here — add the seam (issue-first) rather than calling
  the model.

---

## F. Timeouts

Nearly every spec raises its budget with `test.setTimeout(60_000–120_000)`. That is **legitimate**
here — real CF builds, trigger registration, and long-poll convergence genuinely take that long —
but a long budget is not a settling strategy.

- **NF-F1 (MUST) — A raised timeout must pair with a concrete await, never a sleep.** `setTimeout`
  only buys time for an explicit web-first / `expect.poll` wait to succeed. A long budget wrapped
  around a `waitForTimeout` is a banned race (NF-A1). The budget catches the slow-but-real case; the
  signal-bound wait is what actually passes the test.

- **NF-F2 (SHOULD) — Right-size to the slowest real path in the test, no higher.** Single-tab →
  ~60 s; trigger/AI or cross-tab → ~90 s; two-tab + AI → ~120 s (the chat ceiling). An
  over-generous budget just means a genuinely hung test wastes 90–120 s × retries before it fails,
  slowing the whole feedback loop. Don't pad "to be safe."

- **NF-F3 (MUST NOT) — Don't globally inflate `expect`/action timeouts to mask a race.** Scope a
  longer timeout to the specific assertion that needs it (the `SYNC/CONVERGENCE/TRIGGER` constant),
  not the whole config.

---

## G. Config & harness invariants

These are settled decisions in [`playwright.config.ts`](../apps/web-pwa/playwright.config.ts).
Changing them is a harness change, not a test change — issue-first.

- **NF-G1 (MUST) — No `port`/raw-socket readiness probe to a possibly-free port; emulator + CF
  bring-up stays in `globalSetup`.** The durable rule is the _probe_, not the `webServer` keyword. A
  TCP connect — Playwright's `webServer.port` form, or any raw socket check — to an unbound port can
  hang with no `ECONNREFUSED`, which is what deadlocked the original `webServer` on the old WSL2 host
  (issue #79). Host-side readiness checks are `fetch` + `AbortSignal.timeout(...)`; a `webServer`, if
  ever introduced, MUST gate on `url` (HTTP) or `wait.stdout`, never `port`. The CF-bundle build →
  healthcheck-gated emulator container → env-wired app ordering MUST remain in `globalSetup.ts` /
  `globalTeardown.ts`. See [Harness option: `webServer`](#harness-option-webserver-deferred).

- **NF-G2 (MUST) — Keep `forbidOnly: CI`.** A stray `.only` must fail CI, not silently green it by
  running one test. _Verify:_ `grep -n "\.only(" ` in changed specs returns nothing.

- **NF-G3 (MUST) — Retries are a diagnosis budget, not a pass.** CI runs `retries: 1`, local `0`. A
  test that only passes on the retry is a **bug to fix under these rules**, not a passing test. Watch
  the report's "flaky" count; a non-zero count is a finding, not noise. Do not raise retries to hide
  flake.

- **NF-G4 (MUST) — Preserve, and strengthen, the failure-diagnosis artifacts.** Trace capture and
  `screenshot: 'only-on-failure'` must stay on, and the CI `e2e` job must keep uploading the HTML
  report + traces + `test-results` as artifacts. **Those artifacts _are_ the CI debugging path:**
  download them and open with the normal Playwright UI (`npx playwright show-trace` / `show-report`)
  and CI debugging is identical to local — the downloaded Playwright trace is the only debugging path
  (see NF-I1). **Trace
  mode must be `retain-on-failure`, not `on-first-retry`.** `on-first-retry` only traces the _retry_
  attempt, so for a "passes on retry" flake the retained trace is of a run that _passed_ — useless
  for this suite's exact symptom. `retain-on-failure` keeps the trace of whichever attempt actually
  failed; add `video: 'retain-on-failure'` for the same reason. (The current config still reads
  `on-first-retry` — a known gap closed by the e2e reliability refactor.)

### Harness option: `webServer` (deferred)

The historical "never use `webServer`" prohibition was a **WSL2 artifact, not a general truth**. On
that host a socket connect to an unbound port hung instead of returning `ECONNREFUSED`, so
Playwright's readiness probe deadlocked (issue #79) and `globalSetup` took over the `:5174`
lifecycle. On macOS (current dev host) and on the Linux CI runners the connect refuses immediately —
**CI was never affected** — so the original blocker is gone.

Adopting `webServer` is therefore viable, but it is a **cleanup, not a flake fix**, and it is
**partial**:

- It can own **only** the Vite server. The flake-prone work — `pnpm --filter @salt/cloud-functions
  build` **before** emulator bring-up, `docker compose … up --wait` (healthcheck-gated trigger
  registration), and the `VITE_EMULATOR_*` env wiring — must stay in `globalSetup`, in that order.
  `webServer` cannot express "build a bundle → start a container → wait for a CORS healthcheck."
- If introduced, it MUST use `url`/`wait.stdout` readiness (never `port` — NF-G1),
  `reuseExistingServer: !process.env.CI`, and pass the test-emulator env — replacing the hand-rolled
  `:5174` spawn and the "accepted gap" reuse probe that `globalSetup` carries today.
- It will **not** reduce the current realtime/AI-trigger flake (NF-D/NF-E), and CI's Docker
  healthcheck is already a _stronger_ readiness gate than `webServer`'s HTTP probe.

**Status: deferred.** To be trialled on a throwaway branch (local Mac + CI) once the post-#297 race
fixes land; until then `globalSetup` remains the owner. This is a harness change → issue-first per
CLAUDE.md.

---

## H. Environment-vs-code triage

Not every red is a test defect. Before "fixing" a flaky test, rule out the box.

- **NF-H1 (MUST, on triage) — Broad, simultaneous `toHaveURL`/`toBeVisible` timeouts across
  unrelated specs = environment, not code.** The canonical poisoned-environment signature
  ([docs/e2e.md](e2e.md#spotting--clearing-a-poisoned-environment)) is a clean run degrading to mass
  timeouts with no code change. The container boundary (`down -v` reaps the
  `functionsEmulatorRuntime` tree) makes the classic orphan structurally impossible, but if you see
  it: `E2E_FRESH=1 pnpm --filter @salt/web-pwa e2e` for a pristine stack before editing any spec.

- **NF-H2 (SHOULD) — Reproduce flake by repetition, not by staring.** A "passes on retry" failure is
  reproducible under load: loop the suspect spec (`--repeat-each`) locally to surface the race before
  claiming a fix. A fix you can't make fail first is a guess.

---

## I. Observability & diagnosability

A test that fails opaquely costs more than the bug it caught.

- **NF-I1 (MUST) — Import `test`/`expect` from the shared `./fixtures/test`, never from
  `@playwright/test` directly.** The shared fixture wires the auto-fixtures every spec depends on —
  the per-test Firestore clear (NF-C1) and JS coverage
  ([fixtures/test.ts](../apps/web-pwa/e2e/fixtures/test.ts)); bypassing it silently drops them.
  **Diagnosis path:** the CI flake-debugging tool is the downloaded Playwright trace (NF-G4) — there
  is no remote session-replay fallback. (Historically the e2e harness attached a LaunchDarkly
  session-replay URL, but that machinery was always a no-op under emulators and was retired with the
  PostHog migration.)

- **NF-I2 (SHOULD) — Name the async path you're waiting on.** A descriptive constant (NF-A5) and a
  one-line comment on each non-obvious settle/hold turns a future timeout into a diagnosable line
  instead of a mystery.

---

## Reviewer checklist

Run top-to-bottom on any new/changed spec before reviewing what it asserts. Any unticked `MUST` is a
block.

```
Async & determinism
[ ] NF-A1  No waitForTimeout used to wait for load/save/sync
[ ] NF-A2  Any waitForTimeout is a commented, poll-backed negative-assertion hold only
[ ] NF-A3  All settling via web-first assertions / expect.poll / toPass (no one-shot reads)
[ ] NF-A4  No networkidle / waitForLoadState barriers
[ ] NF-A5  Convergence waits use the named SYNC/CONVERGENCE/TRIGGER/HYDRATE constants

Locators
[ ] NF-B1  Content asserted via role/label/text
[ ] NF-B2  data-testid only on action affordances
[ ] NF-B3  No nth()/structural CSS for stable elements (or justified + commented)

Isolation & state
[ ] NF-C1  workers:1 not raised; global clearFirestore coupling respected
[ ] NF-C2  Per-test identity via uniqueEmail(testId)
[ ] NF-C3  Self-contained; seeds everything it reads; order-independent
[ ] NF-C4  Seeds through the bridge/real adapter (allowlist REST seed before devSignIn)
[ ] NF-C5  Multi-user tabs use separate contexts, closed in finally

Realtime / cross-tab (if applicable)
[ ] NF-D1  Reader tab settled (waitForCanonReady/isCanonSynced) before the writer seeds
[ ] NF-D2  Convergence asserted via expect.poll on the destination store @ CONVERGENCE_TIMEOUT
[ ] NF-D3  Store snapshot preferred over DOM for "did it arrive"

AI / CF triggers (if applicable)
[ ] NF-E1  Every stubAi completes before the action that fires the flow (all stages stubbed)
[ ] NF-E2  Post-trigger state asserted via bridge + poll @ TRIGGER_TIMEOUT, not optimistic DOM
[ ] NF-E3  Canonicalisation kept on the deterministic exact-match path where possible
[ ] NF-E4  No live-model dependency

Timeouts
[ ] NF-F1  Raised test.setTimeout pairs with an explicit signal-bound wait, not a sleep
[ ] NF-F2  Budget right-sized to the slowest real path (~60/90/120s)
[ ] NF-F3  No global expect/action timeout inflation

Harness (only if config/setup touched)
[ ] NF-G1  No port/raw-socket readiness probe; emulator+CF bring-up stays in globalSetup (webServer, if used, gates on url/wait.stdout)
[ ] NF-G2  forbidOnly intact; no stray .only
[ ] NF-G3  Retries not raised to mask flake; flaky-count treated as a finding
[ ] NF-G4  Trace = retain-on-failure (+ video); screenshot/report/test-results artifacts uploaded

Observability
[ ] NF-I1  Imports test/expect from ./fixtures/test (keeps Firestore clear + coverage); diagnosis is the downloaded Playwright trace
[ ] NF-I2  Non-obvious waits named/commented
```

---

## Appendix — evaluation of the generic best-practice list against Salt

The starting point was a generic "stable Playwright" rule list. Not all of it is valuable _here_;
this records the verdicts so the spec stays honest about what it kept and why.

| Generic rule | Verdict for Salt | Reason |
| --- | --- | --- |
| Web-first / retrying assertions | **Kept → NF-A3** | Core; the suite already leans on `expect.poll`/`toPass`. |
| Ban `waitForTimeout` | **Kept but narrowed → NF-A1/A2** | A blanket ban would wrongly flag the legitimate negative-assertion hold in `chat.spec`. Carved a precise exception. |
| Avoid `networkidle`/`waitForLoadState` | **Kept → NF-A4** | Doubly true: the PWA holds Firestore Listen streams open, so it never idles. Suite is already clean — keep it. |
| Accessible-first locators; `data-testid` sparingly | **Kept → NF-B1/B2** | Matches existing authoring conventions. |
| No `nth`/structural CSS | **Kept → NF-B3** | ~25 `nth`/`locator(css)` sites exist; flagged for per-case audit rather than a blanket ban. |
| Per-test unique data | **Kept → NF-C2** | `uniqueEmail(testId)` already does this; made it a hard rule. |
| Reset backend state per test | **Adapted → NF-C1** | Salt does a **global** wipe per test, which is only safe at `workers:1`. The real risk is the _opposite_ of the generic "enable parallelism" advice — so the rule is "don't raise workers," not "parallelise." |
| `fullyParallel` + cross-worker isolation | **Rejected as written** | `workers:1` makes cross-worker DB collisions impossible; `fullyParallel:true` is a no-op today. Generic parallel-safety advice doesn't apply; the global-clear coupling does. |
| `storageState` auth-once | **Rejected** | The app's `window.__e2e.devSignIn` bridge + allowlist seed is the established, faster auth path; `storageState` would bypass the blocking-function ordering this app actually needs to exercise. |
| `forbidOnly` on CI | **Already satisfied → NF-G2** | Set in config. |
| `retries: 2` on CI | **Adapted → NF-G3** | Salt uses `1`; the valuable part isn't the number, it's "a retry-pass is a bug, not a green." |
| `trace`/`screenshot`/`video` on failure | **Corrected → NF-G4/NF-I1** | Trace/screenshot kept, but trace mode moves `on-first-retry`→`retain-on-failure` (the former traces the passing retry, not the failure) and `video: 'retain-on-failure'` is adopted. Downloaded Playwright artifacts are the CI debugging path. |
| `webServer` for app readiness | **Conditional → NF-G1 + [Harness note](#harness-option-webserver-deferred)** | The blanket ban was a WSL2 socket-probe deadlock (issue #79), moot on Mac and Linux CI. Now allowed for the Vite server only, via `url`/`wait.stdout` readiness, with emulator/CF bring-up still in `globalSetup`. Deferred cleanup, not a flake fix. |
| Mock 3rd-party/nondeterministic calls | **Specialised → NF-E1/E4** | Realised concretely as the `FUNCTIONS_AI_FAKE` stub seam + stub-before-fire ordering. |
| Freeze time/randomness | **Kept implicitly → NF-E3 / date-anchoring** | #297 already date-anchors the meal planner off live `this-week` rather than hardcoded dates; folded into determinism. |
| Quarantine, don't ignore | **Kept → NF-G3/H1** | Combined with environment triage so a flaky test is diagnosed, not blanket-retried. |
| Reproduce flake by repetition | **Kept → NF-H2** | `--repeat-each` before claiming a fix. |
| `expect.poll`/`toPass` for eventual state | **Kept → NF-A3/D2/E2** | Already the suite's idiom; made mandatory for convergence/trigger facts. |
| **(net-new)** Realtime long-poll settle-before-act | **Added → NF-D1** | Salt-specific; not in any generic list. The #199 Listen-drop is a leading post-#297 flake cause. |
| **(net-new)** Environment-vs-code triage | **Added → NF-H1** | Salt-specific poisoned-environment signature; prevents "fixing" tests that aren't broken. |
| **(net-new)** Keep the shared `./fixtures/test` import | **Added → NF-I1** | Importing straight from `@playwright/test` silently drops the clear + tagging + coverage fixtures. |
