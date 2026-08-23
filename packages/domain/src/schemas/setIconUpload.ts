import { z } from 'zod';

// Input for the setIconUpload callable (issue #892, Phase 2): a person supplies
// their own photograph in place of the AI-drawn pictogram for a grocery, a
// product form, a kitchen tool or a piece of equipment. They pick a file, crop it
// square in `ImageCropper` (`aspect="1:1"`, ui-spec-v11 §1), and the cropped bytes
// ride here as base64.
//
// RECIPE HEROES ARE NOT A FAMILY HERE. They already have their own upload
// (`SetRecipeImageUploadInputSchema`), which writes a 3:2 hero through
// `encodeHeroImage` rather than a 128px square through `normalizeIconFraming`;
// folding two different pipelines into one discriminator would buy a shared name
// and nothing else. Weather icons are excluded for the reason they are excluded
// everywhere in this issue: seventeen committed static assets, nothing generated
// at request time, nothing to override per item.
export const ICON_UPLOAD_FAMILIES = ['canon', 'productForm', 'kitchenTool', 'equipment'] as const;

export type IconUploadFamily = (typeof ICON_UPLOAD_FAMILIES)[number];

// `imageBase64` is a bare base64 payload (no data-URL prefix), exactly as
// `getCroppedBase64()` returns it and exactly as `setRecipeImageUpload` /
// `setObservationImageUpload` accept it. The 7,000,000-character cap is theirs
// too: base64 inflates bytes ~33%, so it keeps the decoded payload (~5MB) under
// the ~10MB callable request limit. A pictogram crop lands far below it — the
// call sites cap the cropper's long edge well under the 1600px default, because
// the target is a 128px square.
//
// `contentType` is an OPTIONAL, informational hint: sharp auto-detects the real
// format from the bytes, so nothing server-side depends on it.
export const SetIconUploadInputSchema = z.object({
  family: z.enum(ICON_UPLOAD_FAMILIES),
  id: z.string().min(1),
  imageBase64: z.string().min(1).max(7_000_000),
  contentType: z.enum(['image/webp', 'image/jpeg', 'image/png']).optional(),
});

export type SetIconUploadInput = z.infer<typeof SetIconUploadInputSchema>;
