import { z } from 'zod';

// Per-environment developer/operator settings (issue #238). A single Firestore
// singleton doc (`devSettings/singleton`); Firestore is per-project, so this is
// automatically scoped to the environment it lives in.
//
// `canonIconGenerationEnabled` is a global kill-switch for canon-icon AI
// generation. Default = true: a missing doc (or a never-configured environment)
// means generation is ON, so existing environments are unaffected and the CF
// trigger can fail open. Turning it off stops every generation path; turning it
// back on does NOT backfill items created while off (the trigger only retries a
// null-thumbnail item when it is next written).
//
// `recipeImageGenerationEnabled` is the equivalent global kill-switch for the
// Tier-2 recipe hero image (issue #148). Same fail-open default and semantics:
// off stops every recipe-image generation path (create + the regenerate
// callable); re-enabling does not backfill recipes created while off. Independent
// of the canon-icon switch so the two image tiers toggle separately (recipe
// heroes use a costlier model path). Optional-with-default so a devSettings doc
// that predates this field still parses (back-compat on read).
export const DevSettingsSchema = z.object({
  canonIconGenerationEnabled: z.boolean().default(true),
  recipeImageGenerationEnabled: z.boolean().default(true),
  schemaVersion: z.literal(1).default(1),
});

export type DevSettingsDoc = z.infer<typeof DevSettingsSchema>;
