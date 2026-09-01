# Trace propagation — decision record

Why server-side trace propagation is shaped the way it is. The enforceable rules
live in [apps/cloud-functions/CLAUDE.md](../apps/cloud-functions/CLAUDE.md); this
doc holds the reasoning and the history behind them, which is not recoverable from
the code.

## What "one trace" means here

The browser mints a real trace id through its own in-memory OpenTelemetry tracer
(`startUserActionSpan` in `packages/adapters/observability/src/browserTracer.ts`).
That roots the user-action span client-side and exports it to PostHog's
`/i/v1/traces` endpoint. Server-side work then joins that trace rather than starting
its own, so a single user action — a click, a two-step form, an add that fires
downstream triggers — renders as one trace id rooted at the browser.

Without propagation the Genkit flow span re-roots, and the browser action and the
server work appear as two unrelated traces with no way to correlate them after the
fact.

## Why a wire field, and why it supersedes the old stance

The earlier position was: **do not re-add a `_trace` wire field; browser → CF
unification is deferred.** That stance was about a specific bad design — `_trace`
was magic, untyped payload plumbing that flows could see and that nothing
validated.

The current field is a different thing: named, typed, schema-validated by an
explicit wire envelope, and stripped at the entrypoint so no flow ever sees it. It
carries none of the properties the original objection was about, so the stance is
superseded.

The alternative — reading an inbound W3C trace header — was ruled out on a hard
platform constraint rather than a preference. The Firebase callable SDK gives the
client no way to set a custom per-call HTTP header: `HttpsCallableOptions` exposes
only `{ timeout?, limitedUseAppCheckTokens? }`, and the `@firebase/functions`
transport sets its own fixed headers (Content-Type, Authorization, App Check,
Instance-ID). Any header arriving at the function is therefore GCP's own fresh
request-trace root, which by definition cannot carry the browser's id. Preferring
the header would guarantee a re-root. It stays as a fallback because it is better
than nothing when no field is present.

## Why the roll-call is not written down

An earlier version of the CF contract listed which callables carried the field.
It drifted: the list named six while `index.ts` built nine. The wire envelopes in
`packages/domain/src/schemas/traceContextWire.ts` are now the single source, and
the list is deliberately not restated anywhere.

## The 2026-05-11 regression and the env gate

Propagation was originally parked after a regression: with a trace context applied,
flows stopped appearing as roots in the Genkit Dev UI during local development,
which made local flow debugging much harder.

The fix was not to abandon propagation but to gate it. `GENKIT_TELEMETRY_SERVER` is
set by `pnpm dev:emulators`, and when set, both the callable and trigger paths skip
the context entirely and flows stay root-listed. Production is unaffected. The gate
is the reason the feature could ship at all — removing it re-opens the regression.

## Cross-invocation actions (#361)

Add-equipment is a two-call action: `identifyEquipment`, then human think-time,
then `populateEquipmentEntry`. Treating each call as its own trace made a single
user action look like two unrelated ones.

The browser now mints one `startUserActionSpan('Add equipment: <name>')` and
supplies the same `traceparent` to both calls. This forced both from `onCallGenkit`
to `onCall`, which in turn required an explicit AI-OTLP span flush in a `finally`
(the framework's forceFlush is not available on `onCall`) and error reporting at the
entrypoint catch. That flush obligation now applies to every `onCall` flow.

## Triggers (Phase 5)

Firestore triggers have no inbound request to carry context, so the context rides on
the data instead: an optional, additive `traceContext` string on the written
document. The design constraints that shaped it:

- **It must not break Rule 4.** `firebase-sync` forwards the string as an opaque
  value and never imports observability.
- **It must not break domain purity.** The adapter stamps the field at write time;
  the pure-domain `CanonItem` never carries it.
- **It must be back-compatible.** Documents written before the field existed stay
  valid, which the skip-invalid `.safeParse` read path already handles.
- **It must not create a trigger loop.** A write that changes only `traceContext`
  would re-fire the icon and embedding triggers if their idempotency guards keyed
  off document change alone. They key off `thumbnail` / `iconRequestedAt` /
  `embedding` instead, so the bare write-back is inert.
