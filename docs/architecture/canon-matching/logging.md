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

`createFirebaseMatchLoggingAdapter()` in `packages/adapters/firebase-sync/src/canonMatchingLog.ts`:

- Writes to Firestore collection **`canonMatchingLogs`**
- Append-only; documents are never updated or deleted by the adapter
- Errors from `addDoc` are silently caught — the pipeline always succeeds regardless of log write outcome
- No batching, no indexing; this is a debug ledger, not a production query surface

---

## How to inspect logs manually

Using the Firebase Emulator UI or the Firestore console, browse the `canonMatchingLogs` collection. Each document corresponds to one `matchOrCreate` call. Filter by `rawInput` or `finalDecision` to narrow results.

For emulator-based inspection, start the emulators and run a manual pipeline call; the log document appears immediately in the Emulator UI at `http://127.0.0.1:4000`.

---

## How future phases extend this

| Phase | Extension |
|-------|-----------|
| Phase 1 (stages 1–4) | Pipeline calls `log.addStage(...)` for each pure stage |
| Phase 2 (embeddings) | Stage 5 entry added; `reason` field populated with cosine score |
| Phase 3 (AI arbitration) | Stage 6 entry added; `finalDecision` may be `'ai_arbitrated'` |
| Phase 4 (orchestrator) | Pipeline factory wires `MatchLoggingPort` injection |
| Future analytics issue | Separate tooling queries `canonMatchingLogs` for threshold analysis |

No schema changes are needed for Phases 1–4 under the current design.
