import type { AiModelRole } from '@salt/domain/schemas';

// Capability classifier for the live Gemini model catalog (Phase 3).
//
// The catalog's `GET /v1beta/models` entries expose `supportedGenerationMethods`
// (e.g. `generateContent`, `embedContent`) plus name/description metadata. We map
// each admin role to a MINIMUM-capability predicate: a model qualifies for a role
// if it can do at least what the role needs. This is deliberately permissive for
// the reasoning roles — cheaper models (e.g. `flash`) intentionally appear for
// both `fast` and `pro`, because the operator picks the trade-off.
//
// The classifier is pure (no I/O) so it can be unit-tested in isolation and
// reused by both the listAiModels callable (filtering) and testModel (picking the
// right probe method).

/** The catalog fields this classifier reads. A subset of the REST response. */
export interface CatalogModelLike {
  /** Bare model id, e.g. `gemini-flash-latest` (the API returns `models/<id>`). */
  readonly name: string;
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly supportedGenerationMethods?: readonly string[] | undefined;
}

function methods(model: CatalogModelLike): readonly string[] {
  return model.supportedGenerationMethods ?? [];
}

function hasMethod(model: CatalogModelLike, method: string): boolean {
  return methods(model).includes(method);
}

/** Lowercased haystack of every name/metadata field, for heuristic matching. */
function metaHaystack(model: CatalogModelLike): string {
  return [model.name, model.displayName ?? '', model.description ?? ''].join(' ').toLowerCase();
}

// ─── Image predicate ─────────────────────────────────────────────────────────
// The catalog cannot cleanly flag *image generation* capability: image-capable
// models advertise `generateContent` (or a `predict`-family method) just like
// text models, and there is no `generateImage` method. So we gate on a
// name/metadata heuristic IN ADDITION to a generation method:
//   1. the model must expose `generateContent` or `predict`/`predictLongRunning`
//      (i.e. it can be invoked to produce output at all); AND
//   2. its name/metadata must look image-related — it contains the token `image`
//      (e.g. `gemini-2.5-flash-image`, `imagen-3.0`) — while NOT being an
//      embedding model (an `image-embedding`-style id is an embedder, not a
//      generator, so it is excluded).
// This matches today's default (`gemini-2.5-flash-image`) and the Imagen family,
// and stays conservative: a plain text model never leaks into the image picker.
function isImageModel(model: CatalogModelLike): boolean {
  const canGenerate =
    hasMethod(model, 'generateContent') ||
    hasMethod(model, 'predict') ||
    hasMethod(model, 'predictLongRunning');
  if (!canGenerate) return false;
  const hay = metaHaystack(model);
  // `imagen` family or any id/description carrying the standalone `image` token.
  const looksImage = hay.includes('imagen') || /\bimage\b/.test(hay) || hay.includes('-image');
  if (!looksImage) return false;
  // Never treat an embedder as an image generator.
  if (isEmbeddingModel(model)) return false;
  return true;
}

// ─── Embedding predicate ─────────────────────────────────────────────────────
// An embedder advertises `embedContent` (and/or the batch `batchEmbedContents`).
function isEmbeddingModel(model: CatalogModelLike): boolean {
  return hasMethod(model, 'embedContent') || hasMethod(model, 'batchEmbedContents');
}

// ─── Text / reasoning predicate (fast + pro) ─────────────────────────────────
// Any model that can `generateContent` and is NOT an image generator qualifies
// for the reasoning roles. Embedders are excluded (they cannot generate text).
// Both `fast` and `pro` share this predicate by design: the role is about which
// flows use the model, not a hard capability ceiling, so a `flash` model is a
// valid choice for `pro` and a `pro` model is a valid (if pricey) choice for
// `fast`.
function isTextModel(model: CatalogModelLike): boolean {
  if (!hasMethod(model, 'generateContent')) return false;
  if (isEmbeddingModel(model)) return false;
  if (isImageModel(model)) return false;
  return true;
}

/** Role → minimum-capability predicate over a catalog entry. */
export const ROLE_CAPABILITY_PREDICATE: Record<AiModelRole, (model: CatalogModelLike) => boolean> =
  {
    fast: isTextModel,
    pro: isTextModel,
    embedding: isEmbeddingModel,
    image: isImageModel,
  };

/** True if a model qualifies for the given role. */
export function modelSupportsRole(role: AiModelRole, model: CatalogModelLike): boolean {
  return ROLE_CAPABILITY_PREDICATE[role](model);
}

/**
 * The cheapest correct probe method for a model: an embedder is pinged with
 * `embedContent`; everything else (text/reasoning/image-capable) is pinged with
 * `generateContent`. testModel uses this to pick the right ping.
 */
export function probeMethodFor(model: CatalogModelLike): 'embedContent' | 'generateContent' {
  return isEmbeddingModel(model) ? 'embedContent' : 'generateContent';
}

// Exposed for tests / reuse.
export { isImageModel, isEmbeddingModel, isTextModel };
