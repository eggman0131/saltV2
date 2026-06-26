# Canon Matching — Logging & Observability

## Purpose

Every execution of the canon matching pipeline emits a structured `MatchLogEntry` to Firestore. These logs exist for:

- Debugging mismatches during early development
- Manual inspection of which stages fire and why
- Future analytics / threshold-tuning tooling (separate issue)

Logging is fire-and-forget: a log write failure never blocks or errors the pipeline.

---

## Schema

Defined in `packages/domain/src/canon/logging/MatchLogEntry.ts`. `schemaVersion: 1` is embedded in every document.

```ts
interface MatchLogEntry {
  id: string;               // matches the pipeline's own IdGenerator output
  schemaVersion: 1;
  timestamp: string;        // ISO 8601
  rawInput: string;
  normalizedInput: string;
  stages: StageLog[];
  finalDecision: 'matched' | 'created' | 'ai_arbitrated';
  finalItemId: string | null;
}

interface StageLog {
  stage: number;            // 1–6
  stageName: string;
  threshold: number;        // the stop-threshold checked at this stage
  passed: boolean;          // true = a confident match was found here
  candidates: CandidateLog[];
}

interface CandidateLog {
  itemId: string;
  score: number;            // 0–1
  reason?: string;
}
```

Adding new optional fields to any of these types is backwards-compatible. Removing or renaming fields requires a `schemaVersion` bump and a migration plan.

---

## Port contract

```ts
// packages/domain/src/canon/ports/MatchLoggingPort.ts
interface MatchLoggingPort {
  write(entry: MatchLogEntry): Promise<void>;
}
```

The pipeline factory accepts `MatchLoggingPort | null`. When `null` is passed (e.g. in tests or local dev), logging is skipped entirely.

---

## Builder

`MatchLogBuilder` (in `packages/domain/src/canon/logging/MatchLogBuilder.ts`) accumulates state during pipeline execution:

```ts
const log = new MatchLogBuilder();
log.start(rawName, normalisedName);
log.addStage({ stage: 1, stageName: 'normalization', threshold: 1.0, passed: true, candidates: [] });
// …
const entry = log.complete(id, 'matched', matchedItem.id);
await loggingPort?.write(entry);
```

`complete()` snapshots the accumulated stages into a new array so further `addStage` calls don't mutate the returned entry.

---

## Adapter behaviour

Three live `MatchLoggingPort` adapters write canon match logs. None persists to Firestore — match logs are PostHog analytics events and structured CF logs, not a queryable ledger.

`createPosthogMatchLoggingAdapter(path, parentSpan?)` — `packages/adapters/observability/src/posthogMatchLoggingAdapter.ts`

- Browser-side adapter used by the web-pwa fast path.
- Emits the slim `canon.match` PostHog event via `posthog-js` (`posthog.capture`), built through the shared `toCanonMatchEvent` mapper.
- `path` is `'fast'` or `'cf'` and is carried on the event as `canon_path`; `parentSpan` is accepted for call-site signature parity but unused (PostHog has no span primitive).

`createPosthogServerMatchLoggingAdapter(parentSpan?)` — `packages/adapters/observability/src/server/posthogServerMatchLoggingAdapter.ts`

- Cloud Functions counterpart to the browser adapter. Emits the same `canon.match` event via `posthog-node`, tagged `canon_path: 'cf'`.
- Shares the `toCanonMatchEvent` mapper with the browser adapter so the wire schema cannot drift between fast-path and CF emissions.

`createServerMatchLoggingAdapter()` — `apps/cloud-functions/src/adapters/serverMatchLog.ts`

- Writes a structured `canon.match` line via `firebase-functions/logger` for CF-side inspection.
- Logs the one-line `summarizeMatchLog` output plus correlation id, decision, raw/normalized input, final item, and total duration.

All three are fire-and-forget: `MatchLogBuilder.complete()` is called regardless of write outcome, and the pipeline never errors on a failed log write.

---

## How to inspect logs manually

- **Web fast path / CF analytics:** open the PostHog UI and filter on the `canon.match` event. The `canon_*` properties (defined in `toCanonMatchEvent`) carry input, decision, result, winning stage, and confidence for both the `fast` and `cf` paths. For span-level CF traces (the flow span nesting), use the Genkit / Cloud trace view; spans export there via `enableFirebaseTelemetry()`.
- **CF structured logs:** in the Firebase / Google Cloud Logs Explorer, filter on `jsonPayload.message = "canon.match"`. Each entry is one `matchOrCreate` invocation with the summary line and key fields inlined.
