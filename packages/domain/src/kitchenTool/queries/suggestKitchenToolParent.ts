import { normaliseName } from '../../canon/index.js';
import { resolveKitchenTool } from './resolveKitchenTool.js';
import type { KitchenToolDoc } from '../../schemas/kitchenTool.js';

// Which drawn tool does this unnamed label PROBABLY belong to? (Issue #956.)
//
// The curation queue's whole failure mode is that minting a new tool is two
// clicks and aliasing is a search. So the queue asks this first, and when there
// is an answer the cheap action becomes the obvious one: "Alias to Mixing bowl",
// one click, no second drawing.
//
// ADVISORY, NEVER AUTOMATIC — and the reason is in production's own data. Its
// `cooker` cluster is `rice cooker`, `pressure cooker`, `slow cooker` and a
// sous-vide circulator: four different appliances sharing a head noun. A rule
// that folded them would confidently draw a slow cooker for a rice cooker, and
// `mixer` (hand vs stand) and `tin` (cake vs loaf) fail the same way. A hint a
// person accepts is right where a rule would be wrong, which is also why this is
// NOT a fallback inside `resolveKitchenTool`: there the same guess would be made
// silently, at display time, with nobody reviewing it.
//
// THE HEAD NOUN IS THE ENTRY TEST, THE SHARED TAIL IS THE RANKING. Everything a
// modifier can do — "large mixing bowl", "heatproof bowl", "pasta bowl" — leaves
// the last word alone, so sharing it is what makes a tool a candidate at all.
// Between candidates, the one that shares MORE trailing words is the one that
// names the same object: offered `Large mixing bowl` and `Small bowl` for
// "medium mixing bowl", two shared words beat one. That case is not
// hypothetical — it is exactly the shape of the duplicate production acquired.
//
// Nothing cleverer is warranted. Containment has already had its go before this
// function is reached, and a wrong hint costs one glance, so precision here buys
// nothing a person was not going to supply anyway.
//
// Both sides fold through canon's `normaliseName`, the same fold the resolver and
// the queue's grouping use, so a suggestion can never disagree with the row it is
// attached to about what the words are.
export function suggestKitchenToolParent(
  label: string,
  tools: readonly KitchenToolDoc[],
): KitchenToolDoc | null {
  const target = normaliseName(label);
  if (!target) return null;
  // A label the vocabulary can already name is not a queue row at all, so there
  // is nothing to suggest. Asked directly, the honest answer is still "nothing":
  // a hint to alias a word onto the tool it already resolves to would be an
  // invitation to write a matcher that changes nothing.
  if (resolveKitchenTool(label, tools)) return null;

  const words = target.split(' ');
  let best: KitchenToolDoc | null = null;
  let bestShared = 0;
  let bestLength = 0;
  for (const tool of tools) {
    for (const raw of [tool.label, ...tool.matchers]) {
      const phrase = normaliseName(raw);
      if (!phrase) continue;
      const shared = sharedTailLength(words, phrase.split(' '));
      // Zero shared trailing words means a different object entirely; the head
      // noun is the floor, not a tie-break.
      if (shared === 0) continue;
      // More shared words first. Then the SHORTER phrase, which carries less
      // baggage of its own and is therefore the safer parent to fold into. Ties
      // go alphabetically — arbitrary, but the same arbitrary answer on every
      // render, so the button does not reword itself when the store reorders.
      const better =
        best === null ||
        shared > bestShared ||
        (shared === bestShared &&
          (phrase.length < bestLength ||
            (phrase.length === bestLength && tool.label.localeCompare(best.label) < 0)));
      if (better) {
        best = tool;
        bestShared = shared;
        bestLength = phrase.length;
      }
    }
  }
  return best;
}

/** How many trailing words two normalised phrases have in common. */
function sharedTailLength(a: readonly string[], b: readonly string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}
