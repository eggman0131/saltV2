import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ParseEntryAIOutputSchema } from '@salt/domain/schemas';
import { ai } from '../genkit.js';

const GENERATION_MODEL = googleAI.model('gemini-3-flash-preview');

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
    const prompt = buildPrompt(rawText);
    const result = await ai.generate({
      model: GENERATION_MODEL,
      prompt,
      output: { schema: ParseEntryAIOutputSchema },
      config: { temperature: 0 },
    });
    return result.output!;
  },
);

function buildPrompt(rawText: string): string {
  return [
    `You are a shopping-list entry parser. Split the entry below into a clean item name and any trailing context note.`,
    ``,
    `Entry: "${rawText}"`,
    ``,
    `## Rules`,
    `1. **First standalone "for" wins.** Split at the first "for" that is a whole word flanked by whitespace. Everything from that "for" to the end becomes the context. Example: "rice for risotto for friday" → name "rice", context "for risotto for friday".`,
    `2. **No "for" pattern present:** the whole entry is the name and context is an empty string.`,
    `3. **Whitespace:** collapse multiple spaces to one and trim both name and context.`,
    `4. **Casing:** preserve the user's original casing — do not lowercase or uppercase.`,
    `5. **Safety:** if stripping would leave a name with no alphabetic content (e.g. "4 for £1" → "4"), return the full entry as name and "" as context.`,
    ``,
    `Respond with JSON:`,
    `{`,
    `  "name": <clean item name, never empty>,`,
    `  "context": <trailing context starting with "for", or "" if nothing was stripped>`,
    `}`,
  ].join('\n');
}
