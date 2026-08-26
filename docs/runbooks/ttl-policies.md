# Runbook — Firestore TTL policies (issue #1008)

**Two collections are swept by Firestore's TTL machinery: `chatSessions` and
`timerDeliveries`. Both are swept on a field called `expiresAt`, and neither
policy is applied by anything in this repository.** A TTL policy is per-project
infrastructure — it lives in no deployed artefact, no CI job applies it, and
nothing notices if it is missing. This file is the procedure.

Run it once per project, in order: **deploy → migrate → enable → verify**.

## Why this exists

A TTL policy only expires a document whose TTL field holds a Firestore
**`Timestamp`**. A string, a number, or an absent field is skipped **in
silence** — no error, no log, no metric. Salt wrote both fields as neither:

- `chatSessions.expiresAt` was an ISO-8601 **string** from #206 until #1008. The
  14-day / 18-month retention was documented, tested and completely fictional.
  Measured on `s2-stage-ccb22` on 2026-08-25: **42 of 76** chat sessions sat past
  their own recorded expiry, all still present.
- `timerDeliveries` carried an epoch-ms **integer** `deliveredAt` and no expiry
  field at all. Three producers, no deleter, no sweep: 23 documents and only ever
  growing.

#1008 fixed the **write** paths (every new write produces `Timestamp`s, held
there by unit tests at all four write sites) and shipped
`scripts/migrate-ttl-timestamps.mjs` for the documents already written. What it
deliberately did **not** do is run anything: the moment a policy arms, those 42
chats become deletable, and that happens on your schedule, per project, never as
a side effect of a deploy or a CI run.

## What gets deleted, and what does not

- **The 42 past-expiry staging chats (and their prod equivalents) go.** They are
  general (non-recipe) chats already past the retention the product has
  documented since #206. Firestore deletes an expired document within roughly
  24–72 hours of its expiry — the sweep is a background process with no SLA, so
  a policy enabled today shows its effect over the following days, not
  immediately.
- **The 31 pre-#939 sentinel chats stay**, and that is correct. They carry
  `expiresAt: 9999-12-31T23:59:59.999Z`, written before #939 replaced "never"
  with an 18-month window. The migration converts the type and never the instant,
  so they become a year-9999 `Timestamp` — valid, and effectively unexpiring
  until the next turn of that conversation restamps it to 540 days, exactly as
  #939 designed. A migration that silently shortened a recorded expiry would
  delete data nobody agreed to delete.
- **`timerDeliveries` docs expire 14 days after delivery.** The ledger only has
  to outlive a duplicate dispatch, and Cloud Tasks retries span minutes (≤5
  attempts, seconds-to-minutes backoff) while a re-timed timer changes the ledger
  key entirely. The window is `TIMER_DELIVERY_RETENTION_MS` in
  `apps/cloud-functions/src/triggers/timerDeliveryRetention.ts`.

## Order matters

**Deploy before you migrate.** A client running the pre-#1008 bundle writes a
string `expiresAt` on every chat turn. The read path tolerates that for ever by
design (a too-tight read would silently empty a user's chat list — the
subscription skips documents that fail validation), but a stale client writing
strings behind a migration means documents the policy will not sweep. Deploy
first; re-run the migration later if you find stragglers — it is idempotent.

**Migrate before you enable.** Not strictly required — an unconverted document is
skipped rather than mishandled — but enabling first means a policy that appears
to be doing nothing, which is exactly the failure mode this whole issue is about.

---

## Step 1 — deploy

Functions and PWA, per the usual route for that project
([docs/releases.md](../releases.md)). The functions carry the new ledger write
shape; the PWA carries the `Timestamp` chat write and the tolerant read.

## Step 2 — migrate the existing documents

Once per collection per project. It needs your `gcloud` account
(`gcloud auth login`) and nothing else.

```bash
# Preview first — reads only, writes nothing, and prints every document it would touch.
node scripts/migrate-ttl-timestamps.mjs --project dev --collection chatSessions    --dry-run
node scripts/migrate-ttl-timestamps.mjs --project dev --collection timerDeliveries --dry-run

# Then write.
node scripts/migrate-ttl-timestamps.mjs --project dev --collection chatSessions    --apply
node scripts/migrate-ttl-timestamps.mjs --project dev --collection timerDeliveries --apply
```

`--project` takes `dev` | `staging` | `prod` (→ `s2-dev-eggman`,
`s2-stage-ccb22`, `s2-prod-e46bd`). **Production additionally requires
`--confirm production` as a flag** — there is no interactive prompt, deliberately:
a shell without a TTY on stdin hangs on one having already printed a full write
plan, which reads exactly like a crash mid-write.

```bash
node scripts/migrate-ttl-timestamps.mjs --project prod --collection chatSessions \
  --apply --confirm production
```

Each write is a field-level REST `PATCH` (`updateMask.fieldPaths`), so a
concurrent client write to the same document is never clobbered and message
history is neither read nor rewritten. The script is **idempotent**: a document
already holding `Timestamp`s is counted and skipped, so re-running is free and is
how you mop up after a stale client.

## Step 3 — enable the two policies

Once per project. This is the step that arms the sweep.

```bash
for P in s2-dev-eggman s2-stage-ccb22 s2-prod-e46bd; do
  gcloud firestore fields ttls update expiresAt \
    --collection-group=chatSessions --enable-ttl --project="$P"
  gcloud firestore fields ttls update expiresAt \
    --collection-group=timerDeliveries --enable-ttl --project="$P"
done
```

Do them one project at a time in practice — dev, then staging, then prod once
you have seen staging drain. Confirm what is armed:

```bash
gcloud firestore fields ttls list --project="$P"
```

The policy takes a few minutes to build before it begins expiring documents.

## Step 4 — verify

The honest check is a count of documents past their own expiry, before and after.
Firestore aggregation over the REST API, as the same `gcloud` identity:

```bash
P=s2-stage-ccb22
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H 'Content-Type: application/json' \
  "https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents:runAggregationQuery" \
  -d '{"structuredAggregationQuery":{"aggregations":[{"count":{},"alias":"n"}],
       "structuredQuery":{"from":[{"collectionId":"chatSessions"}],
       "where":{"fieldFilter":{"field":{"fieldPath":"expiresAt"},"op":"LESS_THAN",
       "value":{"timestampValue":"'"$NOW"'"}}}}}}'
```

Expect the count to fall to (near) zero over the following 24–72 hours, and to
stay there. Note the filter compares against a `timestampValue`: an unconverted
string document does not match it at all, which is a second way to see that the
migration did its job. Swap `chatSessions` for `timerDeliveries` for the ledger.

## Gotchas

- **A silently-skipped field is the whole defect.** If a count does not drain,
  the first thing to check is the stored type, not the policy: re-run the
  migration in `--dry-run` and see whether it reports documents still to convert.
- **The policy is not in the repo, and never will be.** Nothing in CI applies,
  verifies or notices it; CI has no business talking to a live project. The
  repository's half of the contract is the field type, and that is what the unit
  tests at the four write sites hold.
- **A new collection with an `expiresAt` gets nothing for free.** It needs its
  own `gcloud firestore fields ttls update`, in every project, or its retention
  is decorative in exactly the way this issue documents.
- **Deleting through TTL fires no trigger.** There is no `onDocumentDeleted`
  hook wired to either collection, and nothing downstream depends on the
  documents' continued existence — that is what makes both safe to sweep.
