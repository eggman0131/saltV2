import { z } from 'zod';

// Input for the regenerateRecipeImage callable (issue #148, Tier-2): clears the
// recipe's hero image so the onRecipeWritten trigger regenerates it (and un-hides
// it if it was hidden). Mirrors RegenerateCanonIconInputSchema.
//
// `brief` is the art direction for the next generation — the one-paragraph scene
// description the user edits in the regenerate dialog, pre-filled from the recipe's
// saved `imageBrief`. It is written to `imageBrief`, and the trigger's rule is
// "brief present on the doc → use it verbatim; absent → author one", so omitting it
// (or clearing the box) hands art direction back to describeRecipeScene.
//
// Capped at 2000 chars: an authored brief is one paragraph (~400-800 chars), so this
// leaves generous headroom for a user who rewrites and expands it, while keeping
// unbounded user text out of the image prompt. The prompt's house-style anchors are
// appended after the brief, so an unbounded brief could otherwise crowd them out of
// the model's attention (or the request) entirely. Deliberately far above the 200 of
// `hint` — that steers a brief, this *is* the brief.
export const RegenerateRecipeImageInputSchema = z.object({
  recipeId: z.string().min(1),
  brief: z.string().trim().max(2000).optional(),
  // Retired, still accepted (never written). Nothing sends this since the dialog
  // began editing the brief directly, but an in-flight client bundle still can —
  // accepting and ignoring it keeps those callers off `invalid-argument`. Do not
  // remove without a deploy-window's grace. Phase 3 owns hint-driven brief revision.
  hint: z.string().trim().max(200).optional(),
});

export type RegenerateRecipeImageInput = z.infer<typeof RegenerateRecipeImageInputSchema>;
