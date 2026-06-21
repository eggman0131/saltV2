import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  AppSettingsSchema,
  AI_MODEL_DEFAULTS,
  type AiModelRole,
  type AppSettings,
} from '@salt/domain/schemas';

// CF-side AI model resolver (Phase 1). Reads the admin-managed
// `appSettings/singleton` doc directly via the Admin SDK (Cloud Functions must
// NOT import @salt/firebase-sync). Fails OPEN to today's defaults: a missing,
// empty, invalid, or unreadable doc resolves every role to its hardcoded
// production literal, so deleting/corrupting the doc leaves AI fully working.
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
 * Resolves the configured Gemini model name for an AI role, falling back to the
 * production default for that role. Returns the bare model id (e.g.
 * `gemini-flash-latest`) — callers wrap it in `googleAI.model(...)` /
 * `googleAI.embedder(...)` as before.
 */
export async function resolveModel(role: AiModelRole): Promise<string> {
  const settings = await loadSettings();
  // Schema defaults guarantee a non-empty value, but belt-and-braces fall back
  // to the literal if anything ever slips through.
  return settings[role] || AI_MODEL_DEFAULTS[role];
}

// Test-only: clears the in-process cache between cases.
export function __resetResolveModelCacheForTest(): void {
  cache = null;
}
