import { z } from 'zod';

// Input for the setRecipeImageUpload callable (issue #455, Phase 2): a user picks
// a local photo, crops it to 3:2 in the ImageCropper primitive, and Saves. The
// cropped bytes ride here as a base64 string; the callable re-encodes them
// (encodeHeroImage) and writes `recipe-images/{id}.webp`, then stamps
// `recipe.image = { url, source: 'upload' }`. This is NOT an AI call.
//
// `imageBase64` is a bare base64 payload (no data-URL prefix), decoded server-side
// with `Buffer.from(imageBase64, 'base64')` exactly like the generated-image path.
// The length is bounded as an abuse guard AND to stay within the Cloud Functions
// callable request limit (~10MB): base64 inflates bytes ~33%, so a 7M-character
// cap keeps the decoded payload (~5MB) comfortably under the limit. In practice
// the client caps the cropped output far below this before encoding.
//
// `contentType` is an OPTIONAL, informational hint about the encoding the client
// used — sharp auto-detects the real format from the bytes, so the server does not
// depend on it; it is accepted for forward-compat / logging only.
export const SetRecipeImageUploadInputSchema = z.object({
  recipeId: z.string().min(1),
  imageBase64: z.string().min(1).max(7_000_000),
  contentType: z.enum(['image/webp', 'image/jpeg', 'image/png']).optional(),
});

export type SetRecipeImageUploadInput = z.infer<typeof SetRecipeImageUploadInputSchema>;
