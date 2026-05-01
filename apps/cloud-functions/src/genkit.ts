import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// googleAI() reads GEMINI_API_KEY (or GOOGLE_API_KEY) from process.env at request time.
export const ai = genkit({
  plugins: [googleAI()],
});
