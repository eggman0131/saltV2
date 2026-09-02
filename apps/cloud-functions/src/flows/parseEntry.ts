import { z } from 'genkit';
import { ParseEntryAIOutputSchema, ParseEntryInputSchema } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/observability/server';
import { ai } from '../genkit.js';
import { flowModel } from '../ai/fakeModel.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';

export const parseEntryFlow = ai.defineFlow(
  {
    name: 'parseEntry',
    inputSchema: ParseEntryInputSchema,
    outputSchema: ParseEntryAIOutputSchema,
  },
  async ({ rawText }) => {
    setActiveSpanName(`parseEntry: ${rawText}`);
    const prompt = buildPrompt(rawText);
    // Production: googleAI.model(resolveModel('lite', 'parseEntry')).
    // Under FUNCTIONS_AI_FAKE=1 (emulator e2e only) flowModel returns the
    // deterministic fake model instead; byte-identical otherwise. See
    // ../ai/fakeModel.ts for the cross-process stub contract.
    //
    // This flow is the compound-entry fallback in `onShoppingListItemWrite`, so
    // any spec that adds an entry `looksCompound` reached live Gemini with the
    // dummy emulator key (issue #686 — the offender the hermeticity guard caught
    // on shard 3). Unstubbed the fake throws, and `createServerEntryParseAdapter`
    // catches it into a `NetworkError` exactly as the 400 already did, so the
    // trigger keeps falling back to the deterministic parse — but offline.
    const model = await flowModel('lite', 'parseEntry');
    // The deadline lives HERE, next to the model call, not at the adapter that
    // invokes the flow (issue #915). `parseEntryFlow` is reachable from more
    // than one place, and a caller-side wrapper only covers the callers that
    // remember it. House defaults (20s + 1 retry) — the same budget
    // `createServerEntryParseAdapter` used to apply from outside, so a slow
    // parse behaves exactly as it did.
    //
    // Under FUNCTIONS_AI_FAKE this still routes through the model (the seam is
    // not sealed for this flow — see the note above); the wrapper does not
    // change that either way, it only bounds how long the unsealed call may
    // hang the trigger.
    const result = await withAiTimeout('parseEntry', () =>
      ai.generate({
        model,
        prompt,
        output: { schema: ParseEntryAIOutputSchema },
        config: { temperature: 0 },
      }),
    );
    return result.output!;
  },
);

// `parseShoppingListEntry` (`packages/domain/src/shoppingList/queries/parseEntry.ts`)
// IS THE AUTHORITY for everything below, and this prompt is written to match it —
// never the other way round (issue #934, finding A3-005).
//
// Why that direction, and why it matters at all: `onShoppingListItemWrite` runs
// the deterministic parser FIRST and only reaches this flow when the entry
// `looksCompound` and the parser extracted nothing. So the same entry can be
// handled by either, and until #934 the two disagreed about what a quantity even
// is — the prompt knew only leading DIGITS, so it missed the word-number cardinals
// ("two onions") the parser reads as 2, had no rule at all for a trailing quantity
// ("cucumber 400g", "onions 3"), and its own example claimed "8 rashers of bacon"
// yields unit "rashers" when the parser leaves it in the name, "rashers" not being
// one of the units it recognises.
//
// The examples in rules 3 and 4 below are asserted against the real parser's
// output in `apps/cloud-functions/tests/flows/parseEntry.test.ts`, so a change to
// either side goes red rather than silently re-opening the disagreement.
function buildPrompt(rawText: string): string {
  return [
    `You are a shopping-list entry parser. Parse the entry below into a structured form.`,
    ``,
    `Entry: "${rawText}"`,
    ``,
    `## Rules`,
    `1. **First standalone "for" wins.** Split at the first "for" that is a whole word flanked by whitespace. Everything from that "for" to the end becomes the context. Example: "rice for risotto for friday" → name "rice", context "for risotto for friday".`,
    `2. **No "for" pattern present:** the whole entry is the name and context is an empty string.`,
    `3. **Leading quantity.** Try this FIRST, before rule 4. A "recognised unit" means one of these words exactly, and nothing else: kg, g, mg, lb, lbs, oz, l, ml, cl, dl, litre(s), liter(s), tsp, tbsp, cup(s), pint(s), bag(s), box(es), tin(s), can(s), jar(s), bottle(s), pack(s), packet(s), tub(s), bunch(es), carton(s), sachet(s), pouch(es), tray(s), punnet(s).`,
    `   a. **A written cardinal** — "a", "one" … "twelve" — gives an "amount" and NEVER a "unit", whatever follows it. Everything after the cardinal is the name, minus a leading "of". Examples: "two onions" → amount 2, name "onions"; "a couple of onions" → amount 1, name "couple of onions"; "three bags of flour" → amount 3, name "bags of flour" (NO unit — the cardinal case never takes one).`,
    `   b. **A number attached to letters** gives both: "2kg maris piper potatoes" → amount 2, unit "kg", name "maris piper potatoes".`,
    `   c. **A number then a space** takes a "unit" ONLY if the next word is a recognised unit from the list above; otherwise it is a bare count and the whole remainder is the name. Strip a leading "of". Examples: "1 packet of ginger biscuits" → amount 1, unit "packet", name "ginger biscuits"; "3 onions" → amount 3, name "onions"; "8 rashers of bacon" → amount 8, NO unit, name "rashers of bacon" ("rashers" is not a recognised unit, so it stays in the name).`,
    `   d. **"<number> for …" is price notation, not a quantity** ("4 for £1"): omit amount and unit.`,
    `4. **Trailing quantity.** ONLY when rule 3 found nothing, and applied to the name AFTER the rule-1 "for" split. Same three shapes, at the end of the line: "cucumber 400g" → amount 400, unit "g", name "cucumber"; "potatoes 1 kg" → amount 1, unit "kg", name "potatoes" (recognised unit); "onions 3" → amount 3, name "onions" (bare trailing count). A trailing word that is not a recognised unit stays in the name.`,
    `5. **Conservative extraction:** do not strip product-distinguishing adjectives or variety names into the unit/amount (e.g. "red" in "2 red onions" stays in the name). When ambiguous, keep the word in the name. Never put "of", "for" or any other preposition in the unit field.`,
    `6. **Whitespace:** collapse multiple spaces to one and trim name, context, and unit.`,
    `7. **Casing:** preserve the user's original casing — do not lowercase or uppercase.`,
    `8. **Safety:** if stripping would leave a name with no alphabetic content (e.g. "4 for £1" → "4"), return the full entry as name and "" as context, and omit amount/unit.`,
    ``,
    `Respond with JSON:`,
    `{`,
    `  "name": <clean item name, never empty>,`,
    `  "context": <trailing context starting with "for", or "" if nothing was stripped>,`,
    `  "amount": <the quantity as a JSON number — omit the field entirely if not present>,`,
    `  "unit": <unit string following the number — omit the field entirely if not present>`,
    `}`,
  ].join('\n');
}
