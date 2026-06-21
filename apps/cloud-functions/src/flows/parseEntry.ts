import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ParseEntryAIOutputSchema } from '@salt/domain/schemas';
import { setActiveSpanName } from '@salt/ld-observability/server';
import { ai } from '../genkit.js';
import { resolveModel } from '../ai/resolveModel.js';

const ParseEntryInputSchema = z.object({
  rawText: z.string(),
});

export const parseEntryFlow = ai.defineFlow(
  {
    name: 'parseEntry',
    inputSchema: ParseEntryInputSchema,
    outputSchema: ParseEntryAIOutputSchema,
  },
  async ({ rawText }) => {
    setActiveSpanName(`parseEntry: ${rawText}`);
    const prompt = buildPrompt(rawText);
    const result = await ai.generate({
      model: googleAI.model(await resolveModel('fast', 'parseEntry')),
      prompt,
      output: { schema: ParseEntryAIOutputSchema },
      config: { temperature: 0 },
    });
    return result.output!;
  },
);

function buildPrompt(rawText: string): string {
  return [
    `You are a shopping-list entry parser. Parse the entry below into a structured form.`,
    ``,
    `Entry: "${rawText}"`,
    ``,
    `## Rules`,
    `1. **First standalone "for" wins.** Split at the first "for" that is a whole word flanked by whitespace. Everything from that "for" to the end becomes the context. Example: "rice for risotto for friday" → name "rice", context "for risotto for friday".`,
    `2. **No "for" pattern present:** the whole entry is the name and context is an empty string.`,
    `3. **Leading quantity:** if the entry begins with a number (integer or decimal) optionally followed by a unit, extract them as "amount" (JSON number) and "unit" (string). The unit must be a single word with no prepositions — never include "of", "for", or similar words in the unit field. The name is what remains after the number and unit; strip any leading "of" from it. If no number is present, or extraction would leave an empty name, omit both fields. Examples: "2kg maris piper potatoes" → amount 2, unit "kg", name "maris piper potatoes"; "3 onions" → amount 3, name "onions"; "1 packet of ginger biscuits" → amount 1, unit "packet", name "ginger biscuits"; "8 rashers of bacon" → amount 8, unit "rashers", name "bacon"; "a couple of onions" → no amount, no unit.`,
    `4. **Conservative extraction:** do not strip product-distinguishing adjectives or variety names into the unit/amount (e.g. "red" in "2 red onions" stays in the name). When ambiguous, keep the word in the name.`,
    `5. **Whitespace:** collapse multiple spaces to one and trim name, context, and unit.`,
    `6. **Casing:** preserve the user's original casing — do not lowercase or uppercase.`,
    `7. **Safety:** if stripping would leave a name with no alphabetic content (e.g. "4 for £1" → "4"), return the full entry as name and "" as context, and omit amount/unit.`,
    ``,
    `Respond with JSON:`,
    `{`,
    `  "name": <clean item name, never empty>,`,
    `  "context": <trailing context starting with "for", or "" if nothing was stripped>,`,
    `  "amount": <leading number as a JSON number — omit the field entirely if not present>,`,
    `  "unit": <unit string following the number — omit the field entirely if not present>`,
    `}`,
  ].join('\n');
}
