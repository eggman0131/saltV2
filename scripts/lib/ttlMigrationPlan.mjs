// The decision layer of scripts/migrate-ttl-timestamps.mjs (issue #1008), in a
// module a test can import. The script itself self-executes on import — it parses
// argv, calls `process.exit` on a missing flag, and reaches the network at top
// level — so the two `plan()` functions could never be exercised from it.
// Extracted verbatim in #1021; the plans are covered by
// scripts/tests/ttlMigrationPlan.test.mjs.
//
// `scripts/` is outside the layer map: plain node ESM run from the repo root,
// resolving nothing from `apps/` or `packages/`. This module keeps that — it
// imports nothing at all.

// The `timerDeliveries` retention window, restated from
// apps/cloud-functions/src/triggers/timerDeliveryRetention.ts. Deliberately a
// copy: this script is plain node run from the repo root and resolves nothing
// from apps/cloud-functions (same reason it uses REST rather than the Admin
// SDK), and a one-off migration must keep converting old documents exactly as
// it did the day it ran even if the live window is later retuned.
export const TIMER_DELIVERY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

// One entry per collection with a TTL field to convert. `fields` lists what the
// masked read fetches and the masked write patches; `plan` inspects one raw
// REST document and returns either the exact fields to write or the reason it
// is being left alone.
export const COLLECTIONS = {
  chatSessions: {
    fields: ['expiresAt'],
    plan(doc) {
      const node = doc.fields?.expiresAt;
      if (node === undefined) return { skip: 'has no expiresAt field at all' };
      if (node.timestampValue !== undefined) return { skip: null }; // already converted
      if (node.stringValue === undefined) {
        return { skip: `expiresAt holds ${Object.keys(node)[0] ?? 'nothing'}, not a string` };
      }
      const iso = node.stringValue;
      if (!Number.isFinite(Date.parse(iso))) {
        return { skip: `expiresAt "${iso}" does not parse as a date` };
      }
      // Same instant, new type: the stored ISO-8601 UTC string is already valid
      // RFC 3339, so it is echoed verbatim rather than re-serialised.
      return { write: { expiresAt: { timestampValue: iso } }, detail: iso };
    },
  },
  timerDeliveries: {
    fields: ['deliveredAt', 'expiresAt'],
    plan(doc) {
      const delivered = doc.fields?.deliveredAt;
      const expires = doc.fields?.expiresAt;
      // Both already right → nothing to do. `deliveredAt` alone is not enough:
      // the TTL policy acts on `expiresAt`, and a doc written before #1008 has
      // no such field at all.
      if (delivered?.timestampValue !== undefined && expires?.timestampValue !== undefined) {
        return { skip: null };
      }
      // Every ledger doc ever written carries an epoch-ms `deliveredAt`
      // (`integerValue` — Firestore encodes a whole number that way, as a
      // STRING). A converted one carries a timestamp; either is a usable base
      // for the expiry, and anything else is not this script's business.
      let deliveredMs;
      if (delivered?.integerValue !== undefined) deliveredMs = Number(delivered.integerValue);
      else if (delivered?.timestampValue !== undefined) {
        deliveredMs = Date.parse(delivered.timestampValue);
      } else if (delivered === undefined) {
        return { skip: 'has no deliveredAt field at all' };
      } else {
        return { skip: `deliveredAt holds ${Object.keys(delivered)[0] ?? 'nothing'}` };
      }
      if (!Number.isFinite(deliveredMs)) {
        return { skip: 'deliveredAt does not parse as an instant' };
      }
      const deliveredIso = new Date(deliveredMs).toISOString();
      // The expiry is DERIVED from the delivery instant, not from today: a
      // ledger doc's retention is measured from when it was written, so a
      // migration run months late must not extend the life of every old doc.
      const expiresIso = new Date(deliveredMs + TIMER_DELIVERY_RETENTION_MS).toISOString();
      return {
        write: {
          deliveredAt: { timestampValue: deliveredIso },
          expiresAt: { timestampValue: expiresIso },
        },
        detail: `delivered ${deliveredIso} → expires ${expiresIso}`,
      };
    },
  },
};
