// The one description of what "regenerate this icon" writes (issue #1054).
//
// Two apps request the same regeneration — the admin screens through
// `kitchenToolService`, the canon and product-form callables through
// `requestIconRegeneration` — and `web-pwa` and `cloud-functions` cannot import
// each other (CLAUDE.md Rule 6), so until now each spelled the field set out
// under a comment claiming to reproduce the other field for field.
//
// What is SHARED is the field set. What is NOT shared, deliberately, is how each
// side deletes a stale hint: the client writes a whole-document `setDoc`, where
// omitting the key IS the delete, and the server writes a partial `.update()`,
// where absence means "leave it alone" and the delete has to be an explicit
// `FieldValue.delete()`. That is why this is a builder rather than a shared
// write — a `FieldValue` is a `firebase-admin` value and could not live here
// anyway (Rule 1).
//
// Pure and clockless (Rule 1): the nonce is minted by the caller.

/**
 * The fields a regeneration request writes.
 *
 * `iconHint` is present only when there is a hint to store. Its ABSENCE is what
 * each caller turns into its own kind of delete — so the key is never emitted
 * set to `undefined`, which the Admin SDK rejects outright.
 */
export interface IconRegenerationFields {
  /** Clearing the thumbnail is what re-fires the owning trigger's icon branch. */
  readonly thumbnail: null;
  /**
   * The regenerate nonce, epoch ms. Written on EVERY request, including when the
   * thumbnail is already `null`: writing null over null mutates nothing,
   * Firestore emits no write event and the trigger never runs — which is exactly
   * the case a person hits when a just-added record's first drawing never
   * arrived. A fresh nonce guarantees the write always mutates the document.
   */
  readonly iconRequestedAt: number;
  /** The one-shot steer for this regeneration, trimmed. Absent when none was given. */
  readonly iconHint?: string;
}

/**
 * Build the fields for one icon-regeneration request.
 *
 * `requestedAt` is supplied by the caller — `packages/domain` reads no clock.
 * A missing, empty or whitespace-only `hint` produces no `iconHint` key at all,
 * so a plain regenerate is plain rather than silently inheriting the last steer
 * somebody typed.
 */
export function iconRegenerationFields(
  requestedAt: number,
  hint?: string | null,
): IconRegenerationFields {
  const steer = hint?.trim();
  return {
    thumbnail: null,
    iconRequestedAt: requestedAt,
    ...(steer ? { iconHint: steer } : {}),
  };
}
