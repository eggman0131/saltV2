import { normaliseName } from '../../canon/index.js';
import type { KitchenToolDoc } from '../../schemas/kitchenTool.js';

// Which tools in this vocabulary are named after an INSTANCE of a tool that is
// already drawn? (Issue #956, rule 1.)
//
// `Large mixing bowl` beside `Mixing bowl` is the defect this whole issue is
// named for: two documents, two AI-drawn pictograms, one object. Worse than
// merely wasteful, because `resolveKitchenTool` is longest-phrase-wins — so the
// instance-named row SHADOWS the generic one for the very label the generic was
// seeded to answer. Production holds exactly one of these, and it captures
// "large mixing bowl", the most-asked-for kit label in the library.
//
// ONE FUNCTION, TWO CALLERS, ONE ANSWER. The seed table's own test asserts this
// returns nothing, and `scripts/prune-instance-named-kitchen-tools.ts` runs it
// over the live collection merged with that table. Two notions of "duplicate"
// that could disagree is how the table ends up passing its test while production
// keeps the duplicate.
//
// THE CRITERION IS DELIBERATELY NARROW: a tool's whole normalised LABEL, token-
// aligned, inside another tool's normalised label. Nothing about matchers, and
// nothing about head nouns.
//
//   flags:        `Large mixing bowl` ⊃ `Mixing bowl`
//   does not flag: `Small bowl` — it contains `Mixing bowl`'s MATCHER "bowl",
//                  not its label, and a ramekin is a deliberate second drawing.
//   does not flag: `Rice cooker` beside `Slow cooker` — a shared head noun is
//                  not containment, and those are four different appliances.
//
// NOT `suggestKitchenToolParent`. That answers a different question — "this
// label is unresolved, what might it belong to?" — ranked on shared trailing
// words, and it returns `null` for anything the vocabulary already resolves. A
// seeded `large-mixing-bowl` resolves to itself, so the hint would never fire on
// precisely the document that has to go.
//
// Both sides fold through canon's `normaliseName`, the same fold the resolver
// uses, so this can never disagree with the resolver about which row shadows
// which.

/** An instance-named tool and the generic tool whose picture it duplicates. */
export interface InstanceNamedKitchenTool {
  readonly tool: KitchenToolDoc;
  readonly parent: KitchenToolDoc;
}

export function instanceNamedKitchenTools(
  tools: readonly KitchenToolDoc[],
): readonly InstanceNamedKitchenTool[] {
  const found: InstanceNamedKitchenTool[] = [];
  for (const tool of tools) {
    const target = normaliseName(tool.label);
    if (!target) continue;
    // Pad both sides so containment can only land on whole words: `Pandan
    // whisk` must not be an instance of a tool called `Pan`.
    const padded = ` ${target} `;
    let parent: KitchenToolDoc | null = null;
    let parentLength = 0;
    for (const other of tools) {
      if (other === tool) continue;
      const phrase = normaliseName(other.label);
      // Equal normalised labels are two spellings of one name, not an instance
      // of a generic — a collision for the table's uniqueness check to report,
      // and neither row is the parent of the other.
      if (!phrase || phrase === target) continue;
      if (!padded.includes(` ${phrase} `)) continue;
      // The LONGEST parent, so `Large mixing bowl` folds into `Mixing bowl`
      // rather than a hypothetical `Bowl` — the same longest-phrase-wins rule
      // the resolver applies, which is what makes the pair the shadowing pair.
      // Remaining ties go alphabetically by id: arbitrary, but the same
      // arbitrary answer whatever order the collection arrived in.
      const better =
        parent === null ||
        phrase.length > parentLength ||
        (phrase.length === parentLength && other.id.localeCompare(parent.id) < 0);
      if (better) {
        parent = other;
        parentLength = phrase.length;
      }
    }
    if (parent) found.push({ tool, parent });
  }
  // Sorted by the doomed tool's id so a Firestore listing and a hand-built array
  // of the same documents report in the same order.
  return found.sort((a, b) => a.tool.id.localeCompare(b.tool.id));
}
