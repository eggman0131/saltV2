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
    return decideProductFormProposal(output);
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
    `You are a UK grocery assistant. Decide whether an ingredient is a non-buyable COMPONENT of a buyable product — something the shopper buys the parent for, then extracts.`,
    ``,
    `Ingredient: "${req.ingredientName}"`,
    ...(rawLine ? [rawLine] : []),
    ``,
    `Buyable products already in the catalog (PREFER one of these names when it fits, so an existing product is reused, not duplicated):`,
    candidateList,
    ``,
    `## The test — classify the modifier (set modifier_kind)`,
    `Ask two questions about what the recipe wording does to the base ingredient:`,
    ``,
    `1. Is the modifier an ACTION — a preparation you perform on a product you still buy WHOLE? e.g. "melted" butter, "chopped" onion, "toasted" almonds, "grated"/"softened"/"crushed"/"sliced". You put the SAME product in your basket and prepare it at home. → modifier_kind="action". NOT a form.`,
    ``,
    `2. Is the modifier a physical COMPONENT — a distinct substance you extract from the parent and can NOT normally buy on its own? e.g. "lime juice", "lemon zest", "orange peel", "egg yolk", "egg white". You could not walk into a standard grocery shop and buy a jar of "fresh lime zest" by itself; you buy the whole lime and extract it. → modifier_kind="component". This IS a form.`,
    ``,
    `Otherwise — the ingredient is an ordinary buyable product ("onion", "plain flour", "chicken breast"), OR the modifier is a mere descriptor of a product you buy as-is ("flaky" sea salt, "fresh" thyme, "large" egg, "ripe" tomato), OR no candidate is a plausible parent. → modifier_kind="none". NOT a form.`,
    ``,
    `Rule of thumb: an ACTION or a DESCRIPTOR leaves you buying the same product — not a form. Only a COMPONENT (a different physical substance you extract) is a form.`,
    ``,
    `## Output`,
    `If modifier_kind is "component", set:`,
    `- parent_name: the NAME of the whole product you buy — e.g. "Lime" for lime juice. PREFER an exact name from the catalog list above when one fits, so the existing product is reused; otherwise name the new parent product (it will be created).`,
    `- parent_id: if the parent you named is one of the catalog candidates above, echo its id here (a hint only); otherwise null.`,
    `- matcher: the lowercase phrase identifying this form in an ingredient name, e.g. "lime juice"`,
    `- label: a short human label, e.g. "Lime juice"`,
    `- form_unit: "g", "ml", or "count" — the unit the component is measured in`,
    `- amount_per_parent: how much of form_unit ONE whole parent yields (e.g. one lime ≈ 30 ml juice; one lemon ≈ 5 g zest). A positive number.`,
    `If modifier_kind is "action" or "none", set parent_name, parent_id, matcher, label, form_unit and amount_per_parent to null.`,
    `Always include a brief reasoning string naming which of the two questions decided it.`,
    ``,
  ].join('\n');
}
