// The one piece of scripts/backfill-recipe-times.mjs's `--verify` decision worth
// a test of its own (issue #952 phase 2 review, should-fix 1): whether a
// recipe's stored `timesEstimatedAt` answers the CURRENT `timesRequestedAt`, or
// only an earlier one. The script self-executes on import — it parses argv,
// reaches `gcloud` and the network at top level — so it has no seam otherwise;
// this is pulled out where a test can reach it, the same reason
// scripts/lib/ttlMigrationPlan.mjs exists (its own header explains why).
//
// Both arguments are already-parsed numbers-or-null (the script's `readNumber`
// does the REST-encoding work before calling this).
export function isTimesEstimated(timesRequestedAt, timesEstimatedAt) {
  if (timesEstimatedAt === null) return false; // never estimated
  if (timesRequestedAt === null) return true; // estimated, and nothing has asked since
  return timesEstimatedAt >= timesRequestedAt;
}
