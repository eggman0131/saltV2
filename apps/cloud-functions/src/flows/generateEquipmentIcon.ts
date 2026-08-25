import { z } from 'genkit';
import { defineIconFlow } from './defineIconFlow.js';
import { buildEquipmentIconPrompt } from './equipmentIconPrompt.js';

// Equipment-pictogram generation (issue #877) — the expensive IMAGE step, second
// half of the pair whose first half is describeEquipmentSubject.
//
// The generation body is `defineIconFlow` (issue #989), shared with the canon
// and kitchen-tool families: same committed red-apple seed, same budget, same
// media-null contract. What is this family's own is below — its name (a
// `resolveModel` registry key, #935), its input schema and its prompt builder.
//
// generateCanonIconFlow is deliberately NOT reused, and that is a statement about
// the PROMPT rather than the pipeline. Canon hardcodes the UK-supermarket steer
// into every prompt, which is the wrong direction for an appliance, and its
// name-only prompt cannot render a specific model anyway — which is the entire
// premise of this feature. See equipmentIconPrompt.ts.
//
// The caller is the Draw callable, whose function timeout is raised to suit; it
// is the ONLY wrapper around this call, so there is no outer race that can
// pre-empt the factory's budget.

export const GenerateEquipmentIconInputSchema = z.object({
  // The item's name. Used for the span label and as the degraded fallback
  // subject; when `brief` is present the name does NOT reach the image model —
  // see buildEquipmentIconPrompt for why.
  name: z.string().min(1),
  // The per-item visual brief from describeEquipmentSubject, possibly corrected
  // by the user. Optional so a failed describe step degrades to a genre-level
  // drawing rather than no drawing at all.
  brief: z.string().optional(),
});

export const generateEquipmentIconFlow = defineIconFlow({
  name: 'generateEquipmentIcon',
  inputSchema: GenerateEquipmentIconInputSchema,
  // The NAME, not the brief: the span label wants the thing a person would
  // recognise in a trace, and the brief is a paragraph.
  subjectOf: ({ name }) => name,
  promptOf: ({ name, brief }) => buildEquipmentIconPrompt(name, brief),
});
