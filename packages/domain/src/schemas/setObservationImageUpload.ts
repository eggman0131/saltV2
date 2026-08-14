import { z } from 'zod';

// Input for the setObservationImageUpload callable (issue #812, phase 4 of epic
// #778): a photograph of the crock, the loaf or the mould on the coppa, attached to
// one entry in a batch's observation log. The bytes ride here as base64; the
// callable re-encodes them (encodeHeroImage) and writes
// `batch-images/{batchId}/{observationId}.webp`, then stamps
// `observation.image = { url, source: 'upload' }` with a PARTIAL update. This is
// NOT an AI call — nothing looks at the photo, it is a record.
//
// TWO IDS, both required, because the object path and the document path are both
// nested: the photo belongs to one observation, of one run. The observation
// document must already exist when this is called (the callable's `.update()` is
// partial by design so it cannot clobber a concurrent write, and a partial update
// of an absent document fails) — the client writes the entry, then attaches.
//
// `imageBase64` is a bare base64 payload (no data-URL prefix), decoded server-side
// with `Buffer.from(imageBase64, 'base64')` exactly like the recipe hero path. The
// same 7M-character cap applies for the same two reasons: it is an abuse guard, and
// base64 inflates bytes ~33%, so 7M characters keeps the decoded payload (~5MB)
// comfortably inside the ~10MB Cloud Functions callable request limit.
//
// `contentType` is an OPTIONAL, informational hint about the encoding the client
// used — sharp auto-detects the real format from the bytes, so the server does not
// depend on it; it is accepted for forward-compat / logging only.
export const SetObservationImageUploadInputSchema = z.object({
  batchId: z.string().min(1),
  observationId: z.string().min(1),
  imageBase64: z.string().min(1).max(7_000_000),
  contentType: z.enum(['image/webp', 'image/jpeg', 'image/png']).optional(),
});

export type SetObservationImageUploadInput = z.infer<typeof SetObservationImageUploadInputSchema>;
