# Vitest Unit Suite — Non-Functional Specification

This is the **quality contract** for the Vitest suite: every `*.test.ts` under `packages/**/tests/`
and `apps/**/tests/`. Like [docs/e2e-test-spec.md](e2e-test-spec.md) it is a _non-functional_ spec —
it does not say what a test should assert (that is the test's job), it says what qualities every
test must have to be **behaviour-anchored, cheap to read, and safe to refactor around**.

**How to use it.** Apply this checklist to any new or changed test file _before_ a functional review
of what it asserts. A file that fails a `MUST` is not ready for review. The condensed
[Reviewer checklist](#reviewer-checklist) at the end is the fast path; the numbered requirements
below are the rationale and the verification recipe for each line.

**Why this exists.** The two halves of the test estate had wildly different governance. 9,246 lines
of e2e have had a 418-line binding spec with a 27-item reviewer checklist since the #297 flake wave;
the unit suite reached **96,262 lines with no written convention at all**. #941 measured what that
asymmetry produced: 30.6% of the suite is preamble before the first `it(`, 60 files each declared
their own 17-line `makeStore`, `it.each` appeared 4 times across web-pwa's 1,809 tests, and 1,565
assertions check only that a mock was called. The e2e suite has rules and does not drift; the unit
suite had none and drifted. This document is the recurrence guard #913 requires.

**Conventions.** Each requirement is `MUST` (a green-light blocker) or `SHOULD` (justify a deviation
in the PR). IDs are stable (`UT-A1` …) so reviews and follow-ups can cite them. Every rule carries
the measurement that justifies it; **numbers are as of 2026-08-24 on `main` @ `4a408fb3`** and the
`_Verify:_` line is the command that re-measures it.

**What this spec does not do.** It does not restate the harness.
[`apps/web-pwa/tests/setup.ts`](../apps/web-pwa/tests/setup.ts) already documents, at length and
next to the code, why `asyncUtilTimeout` is 5 s, why `document.body.style.pointerEvents` is reset
after every test, and why `matchMedia` is stubbed. Read it once; this spec points at it and never
paraphrases it.

---

## A. Behaviour over implementation

A unit test earns its place by failing when behaviour changes. An assertion that a function was
called fails when the *wiring* changes — which is precisely what a behaviour-preserving refactor
does, and precisely what it must not fail on.

- **UT-A1 (MUST) — A test's assertions may not consist only of `toHaveBeenCalled*`.** Every `it(`
  must assert at least one observable fact: a returned value, a rendered DOM state, a store's new
  contents, or the argument payload a collaborator received. "The mock was called" is not a fact
  about behaviour; it is a fact about the current call graph.
  **Evidence:** 1,565 of 10,796 assertions (14.5%) are `toHaveBeenCalled*`. In `firebase-sync` it is
  36% — the package with the worst coverage (51.3% lines) and three #913 refactors landing on it.
  `onCookTimerWrite.test.ts` is 11 assertions out of 11; `onKitchenTimerWrite.test.ts` 18 of 20.
  Neither would notice if the trigger wrote the wrong document.
  _Verify:_ in the changed file, every `it(` body must contain an `expect` that is not
  `toHaveBeenCalled*`. `grep -c 'toHaveBeenCalled' <file>` against `grep -c 'expect(' <file>` is the
  smell test; a ratio near 1.0 is a block.

- **UT-A2 (SHOULD) — Prefer `toHaveBeenCalledWith` over `toHaveBeenCalled`.** When a collaborator
  call genuinely is the behaviour under test — a Cloud Function enqueueing a task, an adapter
  issuing a `setDoc` — assert the *payload*. The bare call is satisfied by a call with entirely
  wrong arguments.

- **UT-A3 (MUST) — Do not assert on a private helper the public entry point already covers.**
  Reach for the exported surface. A test bound to an internal name pins the refactor it is supposed
  to protect. (`ssrf.ts` names none of its 8 exports in any test and is **97.3% covered** through
  the `@salt/domain` barrel — that is the shape to aim for, not a defect to fix.)

- **UT-A4 (MUST) — Use the coverage report, not grep-by-symbol, to argue about coverage.** A claim
  that "nothing tests X" derived from grepping for `X` is unsound in a barrel-exporting codebase and
  has already produced two refuted findings in #941.
  _Verify:_ `pnpm test:coverage`.

---

## B. Mocking

- **UT-B1 (MUST) — At most 5 `vi.mock` calls per test file.** Above that the file is testing a
  wiring diagram, not a unit, and every module path in it is a tripwire that a future refactor
  detonates without touching the behaviour under test. Exceed it only with a comment naming why the
  seam cannot be narrowed.
  **Evidence:** 66 of 451 files mock more than 5 modules — web-pwa 40 of 141, cloud-functions 25 of
  92. The worst are `equipment.tracePropagation.test.ts` and `extractRecipeFromPhoto.test.ts` at 25
  each; the RecipeViewPage suites sit at 13–14. `domain` (126 files), `ui-components` (39) and
  `observability` (21) each have **zero** files over the cap, which is why no #913 refactor is
  blocked on them.
  _Verify:_ `grep -c 'vi\.mock(' <file>`.

- **UT-B2 (MUST) — Never mock a module the file could import for real.** A mock that exists because
  mocking is the local habit is pure cost.
  **Evidence:** `auth.svelte` is mocked in 55 files and really imported in **0**; `canonService`
  mocked in 54, real in 7.
  _Verify:_ for each `vi.mock` in the diff, ask what breaks if it is deleted. If the answer is
  "nothing", delete it.

- **UT-B3 (MUST) — Mock at a seam the architecture already defines.** Mock the port, the adapter
  boundary, or the service module — never a deep transitive path a layer below the unit under test.
  A path-shaped mock two layers down encodes the import graph into the test.

- **UT-B4 (MUST NOT) — Do not stub out the guard you are testing under.** 18 CF test files stub
  `withAiTimeout` entirely, so the timeout contract those tests appear to exercise is never run.
  Stubbing a house rule's implementation is how a suite goes green over a violated rule.

---

## C. Preamble and shared fixtures

Preamble is the code before the first `describe(`/`it(`. It is 30.6% of the suite, and it is what
makes a refactor's noise indistinguishable from its breakage.

- **UT-C1 (MUST) — Use the shared kit; do not re-declare what it owns.** The readable-store stand-in
  is [`apps/web-pwa/tests/support/testStore.ts`](../apps/web-pwa/tests/support/testStore.ts)
  (`makeStore`), imported by 61 files. Its header documents the `vi.hoisted` async-import pattern
  that a top-level import cannot satisfy — follow it rather than reinventing a local variant.
  **Evidence:** 60 files once declared their own 17-line copy — ~1,020 duplicated lines in four
  variants differing only in whether the setter was `set` or `_set` (#922).
  _Verify:_ `grep -rn 'function makeStore\|const makeStore' <area>` — in `apps/web-pwa` the only
  legal hit is the kit itself. (`packages/domain`'s three `makeStore` functions are a different
  thing entirely: in-memory `CanonLocalStorePort` fakes, not Svelte stores. Not a violation.)

- **UT-C2 (MUST) — Build domain objects with the real builders.** `emptyRecipe`, `duplicateRecipe`,
  `emptyIngredientGroup`, `newIngredient` and `newStep` are exported from
  [`packages/domain/src/recipe/commands/builders.ts`](../packages/domain/src/recipe/commands/builders.ts).
  A hand-rolled literal drifts from the schema silently and produces the #838 failure mode below.
  **Evidence:** 30 hand-rolled `makeRecipe` helpers existed while the real builders sat unused.

- **UT-C3 (MUST NOT) — Do not repeat what shared setup already does.**
  `document.body.style.pointerEvents = ''` appeared in 31 files while
  [`tests/setup.ts`](../apps/web-pwa/tests/setup.ts) already does it globally in an `afterEach`.
  Before adding any file-level `beforeEach`/`afterEach`, read that file.

- **UT-C4 (SHOULD) — A new helper used by a third file moves to `tests/support/`.** Two copies is a
  coincidence; three is a shared helper that has not been extracted yet. Put it beside `testStore.ts`
  with a header saying what it is for. Note the constraint that put it there: `@salt/testing-utils`
  had zero importers and was deleted under #923, and a replacement package would need an issue-first
  layer-map edit. The kit is deliberately app-local.

---

## D. Table-driven over copied bodies

- **UT-D1 (MUST) — Three or more `it(` blocks differing only in data are one `it.each`.** Copied
  bodies are where drift starts: each copy is later edited independently until no extraction is
  possible without a rewrite.
  **Evidence:** `.each` is used 47 times across 451 files; 4 of those are in web-pwa's 1,809 tests.
  Meanwhile 13 of 25 firebase-sync unit files repeat the same ~35-line `vi.hoisted` +
  `vi.mock('firebase/firestore')` block, each differing just enough to block extraction.
  _Verify:_ read consecutive `it(` bodies in the diff; if a diff between two is only a literal, it
  is a table row.

- **UT-D2 (MUST) — A table's case must name itself in the test title.** Use
  `it.each(cases)('$name …')` or a template table, so a failure names the row. A table that reports
  "case 7" costs more to diagnose than the copies it replaced.

- **UT-D3 (SHOULD) — Derive the table from the source of truth where one exists.** A table over "all
  28 `subscribe*` exports" should read the barrel, not a hand-typed list — see UT-E1. This is what
  makes a table a guard rather than a snapshot of what someone remembered.

---

## E. Source-scanning guards

A guard test that scans source for a rule violation is the strongest recurrence prevention this repo
has. It is also the easiest to render vacuously green.

- **UT-E1 (MUST) — Derive the scan surface from the tree or from the rules file, never from a
  hand-maintained list.** A hard-coded list of files or factories silently stops covering whatever
  is added next.
  **Evidence and the model to copy:**
  [`apps/cloud-functions/tests/aiTimeoutGuard.test.ts`](../apps/cloud-functions/tests/aiTimeoutGuard.test.ts)
  used to scan `src/flows/` flat — which is why it did not catch #915 — and now walks every `.ts`
  under `src`, with a test asserting the walk still finds AI calls outside `src/flows` so a
  re-narrowing fails loudly. Copy that shape.

- **UT-E2 (MUST) — A guard must fail when its target moves.** Add a test that asserts the scan found
  something. A guard that greens on an empty match set has stopped guarding, and nothing else in CI
  will say so.
  **Evidence:** five guards were measured drifting in #941 — `functionMemoryPin` listed 12 factories
  and omitted `makeTracedCallable`; `appCheckEnforcement` carried a hand-maintained
  `MIN_EXPECTED_CALL_SITES = 15` with an in-comment instruction to raise it; `imagePromptSingleSource`
  and `extractProcessStages` matched verbatim English sentences that go green on a reworded prompt.

- **UT-E3 (MUST NOT) — Do not match prose.** Assert on structure — an identifier, an import, a call
  shape — never on a sentence copied out of a prompt constant. Prose is edited for tone by people
  who will never think to look at a test.

- **UT-E4 (MUST) — No `../../../../packages/...` path escapes.** Resolve through the package
  specifier. A relative path out of a package breaks on any file move and encodes the layout.

---

## F. Async, determinism, and the jsdom harness

- **UT-F1 (MUST) — Never tune a wait budget to make a test pass.** The suite's `asyncUtilTimeout` is
  5 s, set globally and reasoned about in `setup.ts`. **A failure whose duration moves with the
  budget is a test bug, not a starved wait** — the predicate does not gate what the test then
  asserts. Fix the predicate.
  **Evidence:** #793/#804. `pnpm soak` (`scripts/soak-unit-tests.mjs`) is how you measure a suspected
  flake rather than arguing about it.

- **UT-F2 (MUST) — Inside a bits-ui focus trap, type with `fireEvent`, not `userEvent.type`.** A
  Sheet or Dialog focus trap eats `userEvent`'s per-keystroke events, so the input receives a
  truncated value and the test fails on an assertion that looks unrelated.
  **Evidence:** #793/#804, the second of that investigation's two root causes.

- **UT-F3 (MUST NOT) — No arbitrary sleeps.** Wait on the real signal: `await waitFor(...)`,
  `findBy*`, or `vi.advanceTimersByTime` under fake timers. A bare `setTimeout` race resolves
  differently under the ~nCPU thread pool this suite runs on.

- **UT-F4 (MUST) — Restore global state you mutate.** Fake timers, `vi.stubEnv`, `vi.stubGlobal`, and
  any direct `window` assignment must be undone in an `afterEach`. Files run in a shared worker;
  leakage lands on an unrelated file and reads as flake.

---

## G. Tooling invariants

- **UT-G1 (MUST) — A new test directory is typechecked.** Test code is not in a package's build
  `tsconfig.json` (`rootDir: "src"`, `composite`, emits to `dist`), so it is invisible to `tsc`
  unless a `tsconfig.test.json` is added **and wired into the root `typecheck` script**.
  **Evidence:** #942 wired `apps/web-pwa/tsconfig.test.json` in and 174 fixture defects fell out of a
  suite that had been green for 41k lines. Every other package's `tests/` is still unchecked —
  `packages/ui-components/tsconfig.test.json` exists and **nothing runs it**, which is the same
  latent state web-pwa was in before #942.
  _Verify:_ `grep typecheck package.json` — the config must appear there, not merely exist.

- **UT-G2 (MUST) — Note what the typecheck does not cover.** `tsconfig.test.json` types the test
  file against the module under test, but `src/env.d.ts`'s `*.svelte` shim types every component as
  a bare `Component` — **props passed from a test are not checked**. Prop checking is `svelte-check`
  (`pnpm check`), a separate job. Do not read a green `typecheck` as "the props are right".

- **UT-G3 (MUST NOT) — Never raise a retry count to green a unit test.** The unit suite has no
  retries and must not gain any. A retry-pass is a finding.

---

## H. Triage — suspect the fixture, not the source

- **UT-H1 (MUST) — When a test dies on a bare `TypeError`, suspect the fixture first.** Six tests
  sat failing that way because their objects were not valid `Recipe`s. The instinct — make the domain
  helper defensive so it tolerates the malformed input — is wrong twice over: it hides the broken
  fixture and it adds a branch to pure code that production can never reach.
  **Evidence:** #838, closed by #942's typecheck rather than by a defensive helper.

- **UT-H2 (SHOULD) — Reproduce before claiming a fix.** `pnpm soak` for a suspected unit flake;
  `--repeat-each` is the e2e equivalent (NF-H2).

---

## Reviewer checklist

Run top-to-bottom on any new/changed test file before reviewing what it asserts. Any unticked `MUST`
is a block.

```
Behaviour over implementation
[ ] UT-A1  No it() whose assertions are all toHaveBeenCalled*
[ ] UT-A2  Collaborator-call assertions check the payload (toHaveBeenCalledWith)
[ ] UT-A3  Asserts the exported surface, not a private helper
[ ] UT-A4  Coverage claims come from pnpm test:coverage, not grep-by-symbol

Mocking
[ ] UT-B1  <= 5 vi.mock per file (or a comment naming why the seam can't narrow)
[ ] UT-B2  No mock of a module the file could import for real
[ ] UT-B3  Mocks sit on an architectural seam, not a deep transitive path
[ ] UT-B4  No stubbing out the house rule under test (e.g. withAiTimeout)

Preamble & shared fixtures
[ ] UT-C1  Uses tests/support/testStore.ts; no local makeStore
[ ] UT-C2  Domain objects via domain builders, not hand-rolled literals
[ ] UT-C3  No beforeEach/afterEach duplicating tests/setup.ts
[ ] UT-C4  A helper reaching its third file moved to tests/support/

Table-driven
[ ] UT-D1  3+ it() blocks differing only in data are one it.each
[ ] UT-D2  Each row names itself in the test title
[ ] UT-D3  Table derived from the source of truth where one exists

Guards (only if the test scans source)
[ ] UT-E1  Scan surface derived from the tree/rules file, never a hand-kept list
[ ] UT-E2  A test asserts the scan found something (fails when the target moves)
[ ] UT-E3  Matches structure, not prose copied from a constant
[ ] UT-E4  No ../../../../packages/... path escape

Async & harness
[ ] UT-F1  No wait budget tuned to pass; a budget-sensitive failure is a test bug
[ ] UT-F2  fireEvent (not userEvent.type) inside a bits-ui focus trap
[ ] UT-F3  No arbitrary sleeps; waitFor/findBy/fake timers
[ ] UT-F4  Fake timers, stubEnv, stubGlobal, window writes restored in afterEach

Tooling (only if a test directory or config is added)
[ ] UT-G1  New tests/ dir has a tsconfig.test.json wired into root `typecheck`
[ ] UT-G2  Svelte props still unchecked by tsc — pnpm check is the prop gate
[ ] UT-G3  No retries added

Triage
[ ] UT-H1  A bare TypeError means fix the fixture, not soften the source
[ ] UT-H2  Suspected flake measured with pnpm soak before a fix is claimed
```

---

## Appendix — what is deliberately NOT a rule

Kept honest in the same spirit as the e2e spec's appendix: rules considered and rejected, so nobody
re-proposes them as oversights.

| Candidate rule | Verdict | Reason |
| --- | --- | --- |
| A per-file line cap | **Rejected** | `CookModePage.test.ts` is 1,894 lines and is the best-protected code in the #913 programme (#925 was dropped from the refactor because of it). Length is not the defect; preamble ratio is, and UT-C1–C4 target that directly. |
| A blanket ban on `vi.mock` | **Narrowed → UT-B1/B2/B3** | `domain`, `ui-components` and `observability` reach 98.7% / 88.0% / 83.2% coverage with 0, 0 and 12 mocks — but `cloud-functions` and `web-pwa` genuinely sit on Firebase and Genkit seams. The rule is a cap and a seam, not a ban. |
| Mandate a coverage floor per file | **Rejected here** | A per-area coverage ratchet is #941 Track A4's job, in CI where it can block. A per-file number in a prose spec is unenforceable and gameable. |
| Ban `toHaveBeenCalled*` outright | **Narrowed → UT-A1/A2** | For a CF trigger whose entire behaviour is "enqueue this task", the call *is* the behaviour. The defect is a test where it is the **only** assertion. |
| Require AAA / given-when-then comment structure | **Rejected** | Adds preamble to fix a preamble problem, and nothing can check it in a minute. |
| Forbid snapshot tests | **Not needed** | The suite has no meaningful snapshot usage to govern; adding a rule for an absent practice is spec bloat. |
| Require a test per exported symbol | **Rejected** | This is exactly the grep-by-symbol error UT-A4 exists to prevent — `ssrf.ts` is 97.3% covered while naming none of its exports. |
