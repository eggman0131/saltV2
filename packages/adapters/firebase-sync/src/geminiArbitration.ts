import { getApp } from 'firebase/app';
import type { CanonArbitrationPort, ArbitrationRequest, ArbitrationResult } from '@salt/domain';

const GENERATION_MODEL = 'gemini-2.0-flash';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const NO_MATCH: ArbitrationResult = { kind: 'no-match' };

export function createGeminiArbitrationAdapter(): CanonArbitrationPort {
  return {
    async arbitrate(req: ArbitrationRequest) {
      const apiKey = getApp().options.apiKey;
      if (!apiKey) {
        return { kind: 'ok', value: NO_MATCH };
      }

      try {
        const resp = await fetch(
          `${BASE_URL}/${GENERATION_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: buildPrompt(req) }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0,
              },
            }),
          },
        );

        if (!resp.ok) {
          return { kind: 'ok', value: NO_MATCH };
        }

        const data = (await resp.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          return { kind: 'ok', value: NO_MATCH };
        }

        return { kind: 'ok', value: parseResult(JSON.parse(text) as unknown) };
      } catch {
        return { kind: 'ok', value: NO_MATCH };
      }
    },
  };
}

function buildPrompt(req: ArbitrationRequest): string {
  const candidateList = req.candidates.length
    ? req.candidates
        .map(
          (c) => `- id: "${c.item.id}", name: "${c.item.name}", score: ${c.confidence.toFixed(3)}`,
        )
        .join('\n')
    : '(none)';

  const aisleList = req.aisles.length
    ? req.aisles.map((a) => `- id: "${a.id}", name: "${a.name}"`).join('\n')
    : '(none)';

  return [
    `You are a grocery canon item matching assistant.`,
    ``,
    `Normalized ingredient name: "${req.normalisedName}"`,
    ``,
    `Candidate matches (id, name, similarity score 0–1):`,
    candidateList,
    ``,
    `Available aisles:`,
    aisleList,
    ``,
    `Respond with JSON in exactly one of these shapes:`,
    `  {"kind":"match","itemId":"<id>","confidence":<0-1>}`,
    `  {"kind":"new","canonName":"<canonical name>","aisleId":"<aisle id or null>"}`,
    `  {"kind":"no-match"}`,
  ].join('\n');
}

function parseResult(raw: unknown): ArbitrationResult {
  if (typeof raw !== 'object' || raw === null) return NO_MATCH;
  const r = raw as Record<string, unknown>;

  if (r['kind'] === 'match') {
    const itemId = typeof r['itemId'] === 'string' ? r['itemId'] : null;
    const confidence = typeof r['confidence'] === 'number' ? r['confidence'] : null;
    if (itemId && confidence !== null) return { kind: 'match', itemId, confidence };
  }

  if (r['kind'] === 'new') {
    const canonName = typeof r['canonName'] === 'string' ? r['canonName'] : null;
    if (canonName) {
      const aisleId = typeof r['aisleId'] === 'string' ? r['aisleId'] : null;
      return { kind: 'new', canonName, aisleId };
    }
  }

  if (r['kind'] === 'no-match') return NO_MATCH;

  return NO_MATCH;
}
