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
  if (meta.length > 0) parts.push(meta.join(', '));
  // The timing, as the phase strip and nothing else (issue #1233). The three old
  // numbers were rendered here until nothing wrote them; showing a chef a stored
  // figure no screen displays is showing it something the cook cannot see.
  const phases = r.metadata.phases ?? [];
  if (phases.length > 0) {
    parts.push(
      `Timing:\n${phases
        .map(
          (p) =>
            `  - ${p.label}: ${p.handsOnMinutes} min hands-on, ${p.handsOffMinutes} min hands-off`,
        )
        .join('\n')}`,
    );
  }
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
