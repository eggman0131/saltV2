import type { RecipeDoc } from '@salt/domain/schemas';

// THE rendering of a stored recipe as prompt text (issue #890). One function,
// because there were two and the poorer one was costing us data.
//
// The librarian had the rich version and the chef had a thin one — title,
// description, ingredient lines and step TEXT, with no servings, no times, no
// step timers and no notes. That gap is invisible until you ask the chef to
// write the dish out again: it cannot preserve a timing it was never shown, so
// a re-authored recipe came back with the timings quietly missing. A chef
// discussing a dish is reading the same document the librarian transcribes;
// there is no reason for the two to see different amounts of it.
//
// Everything here is the recipe itself. Anything ABOUT the recipe that a
// particular flow assembles — the meal's component dishes, the equipment
// manifest — is appended by the caller (see `withComponents`), so this stays a
// pure rendering of one document and each flow keeps its own framing.
export function formatRecipeForPrompt(r: RecipeDoc): string {
  const parts: string[] = [`Title: ${r.title}`];
  if (r.description) parts.push(`Description: ${r.description}`);

  const meta: string[] = [];
  if (r.metadata.servings != null) meta.push(`servings: ${r.metadata.servings}`);
  // Timing is the phase strip (issues #1122, #1213), rendered as the ordered
  // blocks themselves rather than as a total: the model is asked to AMEND a strip
  // and needs to see the one it is amending. Elapsed is derived where it is read
  // and never printed here, for the same reason it is never stored — a second
  // representation is a second thing that can disagree.
  for (const phase of r.metadata.phases ?? []) {
    meta.push(`${phase.label}: ${phase.handsOnMinutes} min hands-on, \
${phase.handsOffMinutes} min hands-off`);
  }
  if (meta.length > 0) parts.push(meta.join(', '));
  if (r.metadata.tags.length > 0) parts.push(`Tags: ${r.metadata.tags.join(', ')}`);

  const ingredientLines: string[] = [];
  for (const group of r.ingredients) {
    if (group.name) ingredientLines.push(`${group.name}:`);
    for (const ing of group.items) {
      ingredientLines.push(`  - ${ing.rawText}${ing.isOptional ? ' (optional)' : ''}`);
    }
  }
  if (ingredientLines.length > 0) parts.push(`Ingredients:\n${ingredientLines.join('\n')}`);

  const stepLines = r.steps.map((s, i) => {
    // Include the timer label so a round-trip preserves it: without the label
    // here the model never sees it and returns it null, silently wiping a
    // hand-typed or previously-authored label (issue #554).
    const timer = s.timer
      ? ` [timer: ${s.timer.durationMinutes} min${
          s.timer.description ? ` — ${s.timer.description}` : ''
        }]`
      : '';
    const note = s.note ? ` (note: ${s.note})` : '';
    return `  ${i + 1}. ${s.text}${timer}${note}`;
  });
  if (stepLines.length > 0) parts.push(`Method:\n${stepLines.join('\n')}`);

  if (r.notes) parts.push(`Notes: ${r.notes}`);

  return parts.join('\n\n');
}

// Appends the meal's attached dishes to the rendered recipe, or leaves it
// exactly as it was when there are none (issue #838). One place for the join so
// every flow puts the dishes in the same position — immediately after the recipe
// they hang off, inside the caller's own section rather than adrift at the top
// level.
export function withComponents(recipeText: string, componentSection: string): string {
  return componentSection ? `${recipeText}\n\n${componentSection}` : recipeText;
}
