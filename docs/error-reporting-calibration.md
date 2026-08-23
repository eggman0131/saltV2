# Caught-error reporting — calibration note

This is the operator/reviewer checklist for the category-gated caught-error
reporting feature. The policy itself lives in
[docs/salt-architecture.md §7.6](salt-architecture.md) ("report the unexpected,
suppress the expected"); the gate is the single shared predicate
`isReportableCategory` in
`packages/adapters/observability/src/shared/reportableCategory.ts`, used verbatim
by both the browser default subpath and the `/server` subpath. This note records
how to confirm the rollout in PostHog and the known, intentional asymmetries so
they are not mistaken for bugs.

## Before/after check in PostHog Error Tracking

Compare the Error Tracking issue list across the deploy boundary.

**Should now be ABSENT (previously noisy — these are expected operational
states, suppressed by category):**

- `NetworkError` / offline — reads and writes degrade gracefully via Firestore
  `persistentLocalCache`; an offline state is not a fault.
- `ValidationError` — invalid user input, not a system failure.
- `NotFound`.
- `ConflictError` — resolved by the LWW policy in `packages/domain`.
- The sign-out / token-refresh `permission-denied` race, where in-flight
  realtime listeners receive `permission-denied` as auth tears down. `AuthError`
  is reportable BY CATEGORY, but this specific teardown race is suppressed
  separately via the auth-transition flag in `@salt/firebase-sync` that catch /
  `onError` call sites consult before reporting. A genuine rules-misconfig
  `permission-denied` (no transition in flight) still reports.

**Should now be PRESENT, with real stacks (previously invisible — a handled
failure never throws, so nothing automatic surfaced it):**

- Browser write / command failures in reportable categories — `StorageError`
  (corruption, quota exceeded, storage unavailable) and `SyncError` (a write the
  user attempted that failed unexpectedly), captured with `error.category`.
- All server-side Cloud Function / callable / AI-Genkit-flow failures —
  unhandled CF exceptions and AI flow failures (timeouts, model errors).
  Uncategorised server exceptions report by default (`undefined → report`).
  These appear under the synthetic server person **`salt-cloud-functions`**
  (the fixed `SERVER_DISTINCT_ID`), not a real user.
- **Since issue #916:** the BROWSER-side half of a Cloud Function 500. A callable
  that 500s reaches the browser SDK as `functions/internal`; every callable
  wrapper in `@salt/firebase-sync` used to end its catch with a
  `NetworkError/transient` catch-all, which both told the user to check their
  connection and suppressed the report. They all now go through the one shared
  `classifyCallableError`, whose catch-all is `StorageError/unavailable`. Expect a
  CF fault to show up TWICE — once server-side under `salt-cloud-functions`, once
  client-side under the real user — and read that as the pair it is, not as a
  double-report bug. What must NOT appear is a `StorageError` for an offline
  user: `classifyCallableError` answers `navigator.onLine` before it reads any
  error code, precisely because a failed fetch arrives under the same
  `functions/internal`. A `StorageError` spike that tracks connectivity rather
  than deploys means that ordering has been broken.

Coverage is uniform across all failure boundaries — write/command failures,
realtime `onError` callbacks, and server CF — gated by category, not by which
call site happens to expose an `onError`.

## Uncaught errors — separate, automatic path

The category gate above governs **caught** errors only. **Uncaught** errors
(unhandled exceptions and promise rejections) are captured automatically by
PostHog's exception autocapture and appear as Error Tracking issues independently
of `ErrorReportingPort`. This is controlled by the PostHog **project-level**
autocapture setting — the browser SDK init (`init.ts`) does not set
`capture_exceptions`, so no code change gates, forces, or duplicates it.

Two consequences for the before/after read:

- Caught errors are caught, so they never reach autocapture — nothing this
  feature explicitly reports is double-counted.
- The "should be ABSENT" list applies to the **explicit caught path**. A failure
  in an otherwise-suppressed category (e.g. a `NetworkError`) that escapes
  **uncaught** can still surface via autocapture. That is acceptable: an uncaught
  error is genuinely unexpected regardless of the category it would have mapped to.

## Known, intentional asymmetries (NOT bugs)

1. **Server reports carry no `error.category` property.** The client adapter
   attaches `{ 'error.category': <kind> }`; the server adapter calls
   `captureServerException(err)` → `captureException(err, SERVER_DISTINCT_ID)`
   with the distinctId only and no properties bag — even when a category is
   known. This is a deliberate scope decision for this feature (adding it would
   be a behaviour change); attaching the category server-side is a possible
   future enhancement, intentionally NOT done here. The report/suppress
   *decision* is identical on both sides — only the attached metadata differs.

2. **Some AI-flow failures do not surface as server reports.** Certain
   embed / arbitrate / parse flow failures are reached via adapters that
   downgrade them to a SUPPRESSED `NetworkError` Result. Because the gate keys on
   category, that downgrade means the failure is not re-reported as a server
   exception — this is intentional, to avoid double / over-reporting the same
   underlying condition through two paths.

## No raw user content in payloads

The error's own message and stack are KEPT — they are the signal. The invariant
is narrower: no SEPARATE free-form context / properties bag carrying user input
(canon match text, recipe ingredient strings, …) is attached to a reported
event. This is enforced by the scrubbing tests in
`packages/adapters/observability/tests/payloadScrubbing.test.ts` (client:
captured properties are exactly `['error.category']`; server: only the
distinctId string, no properties bag), and the client/server parity is locked by
`packages/adapters/observability/tests/reportabilityParity.test.ts`.
