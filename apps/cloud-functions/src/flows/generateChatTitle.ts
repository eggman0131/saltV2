import { z } from 'genkit';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { ai } from '../genkit.js';
import { flowModel } from '../ai/fakeModel.js';

const InputSchema = z.object({
  userMessage: z.string(),
  assistantResponse: z.string(),
});

const SYSTEM_PROMPT = `You are a conversation title generator.
Given the user's first message to a cooking assistant and the assistant's first reply,
output a concise title of 2-5 words that captures the main topic.
Examples: "Macaroni Cheese", "Thai Green Curry", "Sourdough Bread", "Vegetarian Pasta".
Output only the title — no quotes, no punctuation, no explanation.`;

export const generateChatTitleFlow = ai.defineFlow(
  {
    name: 'generateChatTitle',
    inputSchema: InputSchema,
    outputSchema: z.string(),
  },
  async (input) => {
    const prompt = `User's message: "${input.userMessage}"\n\nChef's reply:\n${input.assistantResponse.slice(0, 500)}`;

    const model = await flowModel('lite', 'generateChatTitle');
    const result = await withAiTimeout(
      'generateChatTitle',
      () =>
        ai.generate({
          model,
          system: SYSTEM_PROMPT,
          prompt,
          config: { temperature: 0.3 },
        }),
      { timeoutMs: 15_000, retries: 0 },
    );

    return (result.text ?? '').trim().slice(0, 60) || 'New chat';
  },
);
