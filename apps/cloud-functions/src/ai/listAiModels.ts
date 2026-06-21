import { z } from 'genkit';
import { HttpsError, type CallableRequest } from 'firebase-functions/https';
import { logger } from 'firebase-functions';
import { AI_MODEL_ROLES, type AiModelRole } from '@salt/domain/schemas';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { requireAdmin } from './requireAdmin.js';
import { modelSupportsRole, type CatalogModelLike } from './modelCapabilities.js';

// Admin-only callable that serves a live, capability-filtered Gemini model
// catalog to the admin UI (Phase 3). Fetches `GET /v1beta/models` server-side
// with the API key (the key NEVER reaches the browser — only the filtered
// catalog does), classifies each model, and returns one list per admin role.
//
// An in-process cache (~1h) keeps the external fetch cheap across warm
// invocations; a `forceRefresh` request flag bypasses it so the operator's
// "Refresh" control always pulls fresh data.
//
// onCall (NOT onCallGenkit): this is not a Genkit flow; it re-checks admin and
// calls a plain REST endpoint. App Check enforcement + the AI secret are wired
// at the export site in index.ts.

const CATALOG_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
const CACHE_TTL_MS = 60 * 60 * 1000; // ~1 hour

// ─── REST response shape (type-laundering boundary → validate) ───────────────
const CatalogModelSchema = z.object({
  // The API returns `models/<id>`; we normalise to the bare id below.
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
});
const CatalogResponseSchema = z.object({
  models: z.array(z.unknown()).optional(),
});

// ─── Request / response contracts ────────────────────────────────────────────
const ListAiModelsInputSchema = z
  .object({ forceRefresh: z.boolean().optional() })
  .optional()
  .default({});

export interface AiCatalogModel {
  /** Bare model id, e.g. `gemini-flash-latest`. */
  readonly name: string;
  readonly displayName: string;
}
export interface ListAiModelsResult {
  /** Filtered catalog per role; each role lists only models that qualify. */
  readonly byRole: Record<AiModelRole, AiCatalogModel[]>;
  /** When the underlying catalog was fetched (ms epoch). */
  readonly fetchedAt: number;
}

type CacheEntry = { result: ListAiModelsResult; expiresAt: number };
let cache: CacheEntry | null = null;

/** Strip the `models/` prefix the API prepends to every id. */
function bareId(name: string): string {
  return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

/** Fetches + parses the raw catalog, then builds the role-filtered result. */
async function fetchCatalog(): Promise<ListAiModelsResult> {
  const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'AI model catalog is unavailable.');
  }

  const res = await withAiTimeout('listAiModels.fetch', () =>
    fetch(CATALOG_URL, { headers: { 'x-goog-api-key': apiKey } }),
  );
  if (!res.ok) {
    logger.warn('listAiModels: catalog fetch returned non-OK', { status: res.status });
    throw new HttpsError('unavailable', 'AI model catalog is unavailable.');
  }

  const json: unknown = await res.json();
  const parsed = CatalogResponseSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('listAiModels: catalog response failed validation');
    throw new HttpsError('unavailable', 'AI model catalog is unavailable.');
  }

  // Per-model validation: skip any malformed entry rather than failing the
  // whole catalog (one bad model must not blank the picker).
  const models: CatalogModelLike[] = [];
  for (const raw of parsed.data.models ?? []) {
    const m = CatalogModelSchema.safeParse(raw);
    if (!m.success) continue;
    models.push({ ...m.data, name: bareId(m.data.name) });
  }

  const byRole = {} as Record<AiModelRole, AiCatalogModel[]>;
  for (const role of AI_MODEL_ROLES) {
    byRole[role] = models
      .filter((m) => modelSupportsRole(role, m))
      .map((m) => ({ name: m.name, displayName: m.displayName ?? m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return { byRole, fetchedAt: Date.now() };
}

/** Cache-aware accessor; `forceRefresh` bypasses + refills the cache. */
async function loadCatalog(forceRefresh: boolean): Promise<ListAiModelsResult> {
  const now = Date.now();
  if (!forceRefresh && cache && cache.expiresAt > now) return cache.result;
  const result = await fetchCatalog();
  cache = { result, expiresAt: now + CACHE_TTL_MS };
  return result;
}

export async function handleListAiModels(request: CallableRequest): Promise<ListAiModelsResult> {
  await requireAdmin(request);
  const input = ListAiModelsInputSchema.safeParse(request.data);
  if (!input.success) {
    throw new HttpsError('invalid-argument', 'Invalid request payload.');
  }
  return loadCatalog(input.data.forceRefresh ?? false);
}

// Test-only: clears the in-process catalog cache between cases.
export function __resetListAiModelsCacheForTest(): void {
  cache = null;
}
