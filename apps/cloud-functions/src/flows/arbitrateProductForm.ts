import { googleAI } from '@genkit-ai/google-genai';
import { decideProductFormProposal } from '@salt/domain';
import {
  ProductFormArbitrationRequestSchema,
  ProductFormArbitrationAIOutputSchema,
  ProductFormProposalSchema,
  type ProductFormArbitrationRequest,
} from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';

// Product-form arbitration (issue #500, Phase 3). Given an ingredient that did
// not resolve to an existing form or match a buyable canon item as itself, ask
// the model whether it is a non-buyable FORM of one of the offered candidates and,
// if so, which parent + suggested yield. The flat AI answer is mapped to a
// validated proposal by the pure-domain `decideProductFormProposal` (identical
// discipline to arbitrateCanon → CanonArbitrationAIOutputSchema). A "not a form"
// / malformed answer comes back as `{ kind: 'none' }` — never throws (Rule 10).
export const arbitrateProductFormFlow = ai.defineFlow(
  {
    name: 'arbitrateProductForm',
    inputSchema: ProductFormArbitrationRequestSchema,
    outputSchema: ProductFormProposalSchema,
  },
  async (req) => {
    setActiveSpanName(`arbitrateProductForm: ${req.ingredientName}`);
    const model = await resolveModel('lite');
    const result = await ai.generate({
      model: googleAI.model(model),
      prompt: buildPrompt(req),
      output: { schema: ProductFormArbitrationAIOutputSchema },
      config: { temperature: 0 },
    });
    const output = result.output;
    if (!output) return { kind: 'none' as const };
    const validParentIds = new Set(req.candidates.map((c) => c.id));
    return decideProductFormProposal(output, validParentIds);
  },
);

function buildPrompt(req: ProductFormArbitrationRequest): string {
  const candidateList = req.candidates.length
    ? req.candidates.map((c) => `- id: "${c.id}", name: "${c.name}"`).join('\n')
    : '(none)';
  const rawLine =
    req.rawText !== undefined && req.rawText !== req.ingredientName
      ? `Raw ingredient text (context only): "${req.rawText}"`
      : null;

  return [
    `You are a UK grocery assistant. Decide whether an ingredient is a non-buyable FORM of a buyable product a shopper would actually put in their basket.`,
    ``,
    `Ingredient: "${req.ingredientName}"`,
    ...(rawLine ? [rawLine] : []),
    ``,
    `Buyable products already in the catalog (choose the parent from THIS list only, by id):`,
    candidateList,
    ``,
    `## What counts as a form`,
    `A "form" is a preparation or derivative of a whole buyable product — e.g. "grated nutmeg" is a form of the buyable "Nutmeg"; "lime juice" is a form of "Lime"; "melted butter" is a form of "Butter". The form itself is NOT normally bought as a distinct SKU; the shopper buys the parent and prepares the form.`,
    `- If the ingredient IS itself an ordinary buyable product (e.g. "onion", "chicken breast", "plain flour"), it is NOT a form. Set is_form=false.`,
    `- If no candidate is a plausible parent, set is_form=false.`,
    ``,
    `## Output`,
    `If is_form is true, set:`,
    `- parent_id: the id of the parent from the list above`,
    `- matcher: the lowercase phrase identifying this form in an ingredient name, e.g. "grated nutmeg"`,
    `- label: a short human label, e.g. "Grated nutmeg"`,
    `- form_unit: "g", "ml", or "count" — the unit the form is measured in`,
    `- amount_per_parent: how much of form_unit ONE whole parent yields (e.g. one nutmeg ≈ 12 g grated; one lime ≈ 30 ml juice). A positive number.`,
    `If is_form is false, set parent_id, matcher, label, form_unit and amount_per_parent to null.`,
    `Always include a brief reasoning string.`,
    ``,
  ].join('\n');
}
