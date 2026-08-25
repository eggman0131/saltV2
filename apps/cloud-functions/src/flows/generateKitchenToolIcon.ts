import { z } from 'genkit';
import { defineIconFlow } from './defineIconFlow.js';
import { buildKitchenToolIconPrompt } from './kitchenToolIconPrompt.js';

// Kitchen-tool pictogram generation (issue #882) — the fourth subject family on
// the Tier-1 pipeline.
//
// The generation body is `defineIconFlow` (issue #989), shared with the canon
// and equipment families: same committed red-apple seed, same budget, same
// media-null contract. What is this family's own is below — its name (a
// `resolveModel` registry key, #935), its input schema and its prompt builder.
//
// generateCanonIconFlow is deliberately NOT reused, and that is a statement
// about the PROMPT rather than the pipeline. Canon hardcodes the UK-supermarket
// steer ("The item is as commonly sold in a UK supermarket.") into every prompt,
// which points a hand tool at retail packaging, and it carries none of the
// no-lettering-on-the-object prohibition a branded pan handle needs. See
// kitchenToolIconPrompt.ts.

export const GenerateKitchenToolIconInputSchema = z.object({
  // The tool's curated label — "Mixing bowl", "Balloon whisk". It IS the subject:
  // this family draws the generic tool a recipe means, so there is no per-item
  // brief step in front of it the way equipment has one.
  label: z.string().min(1),
  // Optional additive steer, written onto the document by whoever judged the last
  // drawing wrong. Appended to the locked prompt, never replacing any of it.
  hint: z.string().optional(),
});

export const generateKitchenToolIconFlow = defineIconFlow({
  name: 'generateKitchenToolIcon',
  inputSchema: GenerateKitchenToolIconInputSchema,
  subjectOf: ({ label }) => label,
  promptOf: ({ label, hint }) => buildKitchenToolIconPrompt(label, hint),
});
