import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  AppSettingsSchema,
  AI_MODEL_DEFAULTS,
  AI_FLOW_ROLES,
  type AiFlowId,
  type AppSettings,
} from '@salt/domain/schemas';

// CF-side AI model resolver (Phase 1 + Phase 2). Reads the admin-managed
// `appSettings/singleton` doc directly via the Admin SDK (Cloud Functions must
// NOT import @salt/firebase-sync). Fails OPEN to today's defaults: a missing,
// empty, invalid, or unreadable doc resolves every role to its hardcoded
// production literal, so deleting/corrupting the doc leaves AI fully working.
//
// Phase 2 added an optional per-flow override: a non-empty `perFlow[flowId]`
// entry wins over the role's model. Precedence is per-flow override → role →
// code default.
//
// Issue #935 made the flow id the ONLY argument, and the role a lookup in
// `AI_FLOW_ROLES`. Two things follow, and both are the point:
//   • a flow with no registry entry cannot resolve a model, because there is no
//     signature that accepts it — so the admin override list on
//     /admin/app-settings cannot be missing a job that CF actually runs;
//   • a call site cannot name a role that disagrees with the registry, because
//     it no longer names one.
//
// An in-process TTL cache (180s) keeps per-invocation Firestore reads cheap and
// bounds propagation latency: an admin change takes effect within ~3 minutes as
// warm instances expire their cache and cold starts read fresh.

const COLLECTION = 'appSettings';
const SINGLETON_DOC_ID = 'singleton';
const CACHE_TTL_MS = 180_000;

type CacheEntry = { settings: AppSettings; expiresAt: number };
let cache: CacheEntry | null = null;

// The defaulted doc — every role on its production literal. Used as the fallback
// whenever the stored doc is absent or unusable.
const DEFAULT_SETTINGS: AppSettings = AppSettingsSchema.parse({});

async function loadSettings(): Promise<AppSettings> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.settings;

  let settings = DEFAULT_SETTINGS;
  try {
    const snap = await getFirestore().collection(COLLECTION).doc(SINGLETON_DOC_ID).get();
    if (!snap.exists) {
      logger.info('resolveModel: no appSettings doc, using model defaults');
    } else {
      const parsed = AppSettingsSchema.safeParse(snap.data());
      if (parsed.success) {
        settings = parsed.data;
      } else {
        logger.warn('resolveModel: invalid appSettings doc, using model defaults');
      }
    }
  } catch (err) {
    logger.warn('resolveModel: appSettings read failed, using model defaults', { err });
  }

  cache = { settings, expiresAt: now + CACHE_TTL_MS };
  return settings;
}

/**
 * Resolves the Gemini model name a flow should use. Precedence:
 *   1. per-flow override — `perFlow[flowId]`, when that key holds a non-empty
 *      value;
 *   2. the configured model for the flow's role (`AI_FLOW_ROLES[flowId]`);
 *   3. that role's production default.
 * Returns the bare model id (e.g. `gemini-flash-latest`) — callers wrap it in
 * `googleAI.model(...)` / `googleAI.embedder(...)`.
 *
 * The flow id is the only argument by design: the role comes from the registry,
 * so no call site can pass one that disagrees with it, and a flow absent from
 * the registry does not typecheck here.
 */
export async function resolveModel(flowId: AiFlowId): Promise<string> {
  const settings = await loadSettings();
  // Per-flow override wins when present and non-empty. The schema already
  // rejects empty override values, but guard anyway so a hand-edited doc can
  // never resolve to an empty model id.
  const override = settings.perFlow?.[flowId];
  if (override && override.trim()) return override;
  const role = AI_FLOW_ROLES[flowId];
  // Schema defaults guarantee a non-empty role value, but belt-and-braces fall
  // back to the literal if anything ever slips through.
  return settings[role] || AI_MODEL_DEFAULTS[role];
}

// Test-only: clears the in-process cache between cases.
export function __resetResolveModelCacheForTest(): void {
  cache = null;
}
