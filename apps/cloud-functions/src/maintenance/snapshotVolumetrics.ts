import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { captureServerEvent, flushServerObservability } from '@salt/observability/server';
import { RecipeKindSchema } from '@salt/domain/schemas';
import { reportServerError } from '../observability/reportServerError.js';

// Daily collection-size snapshot (issue #684).
//
// WHY AN EVENT AND NOT A DOC — the counts exist so PostHog can graph growth and
// ALERT when a collection crosses an architecture threshold (e.g. the canon size
// gate that #410's projection/findNearest work is parked on). PostHog alerts can
// only watch PostHog data, so the counts must land there as an event; writing
// them anywhere in Firestore would be a stats-collection schema change, which
// #684 forbids. History/SQL over documents is the BigQuery export's job, not
// this function's.
//
// COST SHAPE — count() aggregation only: the server tallies without streaming
// documents, billed at one read per 1,000 counted. Eight aggregate queries a
// day, no document reads, no writes.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// The snapshot is a point-in-time gauge, so WHEN it runs barely matters — 02:30
// just keeps it clear of the 03:00 weekly sweep. Same fixed-zone rationale as
// remindShoppingDay: onSchedule's timeZone is a deploy-time constant.
const SNAPSHOT_TIME_ZONE = 'Europe/London';

export const VOLUMETRICS_SNAPSHOT_EVENT = 'volumetrics.snapshot';

export const snapshotVolumetrics = onSchedule(
  {
    schedule: '30 2 * * *',
    timeZone: SNAPSHOT_TIME_ZONE,
    region: 'europe-west2',
    secrets: [posthogApiKey],
    // A failed run costs one day's data point in a slow-moving curve — not worth
    // Scheduler replaying a deterministic failure (same stance as remindShoppingDay).
    retryCount: 0,
  },
  async () => {
    const db = getFirestore();
    try {
      // `kind` is schema-defaulted ('recipe'), not stored, on pre-#637 docs — and
      // Firestore cannot query for an absent field. So the explicit kinds are
      // counted directly and plain recipes are derived as total minus the rest;
      // counting where('kind','==','recipe') would silently drop every recipe
      // created before kinds existed.
      const explicitKinds = RecipeKindSchema.options.filter((k) => k !== 'recipe');
      const [recipesTotal, canonTotal, canonPending, formsTotal, formsPending, ...kindCounts] =
        await Promise.all([
          db.collection('recipes').count().get(),
          db.collection('canonItems').count().get(),
          db.collection('canonItems').where('needs_approval', '==', true).count().get(),
          db.collection('productForms').count().get(),
          // needs_approval is optional on productForms; docs without it are
          // approved-era writes and correctly fall out of the pending count.
          db.collection('productForms').where('needs_approval', '==', true).count().get(),
          ...explicitKinds.map((kind) =>
            db.collection('recipes').where('kind', '==', kind).count().get(),
          ),
        ]);

      const recipesTotalCount = recipesTotal.data().count;
      const kindProps: Record<string, number> = {};
      let explicitSum = 0;
      explicitKinds.forEach((kind, i) => {
        const count = kindCounts[i]?.data().count ?? 0;
        kindProps[`recipes_${kind}`] = count;
        explicitSum += count;
      });
      const counts: Record<string, number> = {
        recipes_total: recipesTotalCount,
        ...kindProps,
        recipes_recipe: recipesTotalCount - explicitSum,
        canon_items_total: canonTotal.data().count,
        canon_items_needs_approval: canonPending.data().count,
        product_forms_total: formsTotal.data().count,
        product_forms_needs_approval: formsPending.data().count,
      };

      // Counts only — no titles, no user content (the scrubbing rule). Rides the
      // synthetic server person; `deployment.environment` is stamped by
      // captureServerEvent, which is what scopes dashboards/alerts to production.
      captureServerEvent(VOLUMETRICS_SNAPSHOT_EVENT, counts);
      logger.info('snapshotVolumetrics: captured', counts);
    } catch (err) {
      // Never throw out of a scheduled handler (Rule 10) — report and let
      // tomorrow's run supply the next point.
      logger.error('snapshotVolumetrics: failed', { error: String(err) });
      reportServerError(err, 'SyncError');
    } finally {
      await flushServerObservability();
    }
  },
);
