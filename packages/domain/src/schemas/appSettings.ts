import { z } from 'zod';

// Admin-managed AI model selection (Phase 1). A single Firestore singleton doc
// (`appSettings/singleton`); Firestore is per-project, so this is automatically
// scoped to the environment it lives in.
//
// Each role field names the Gemini model used by a class of AI flows. Every
// field `.default()`s to today's exact production literal, so a missing,
// empty, or never-configured doc resolves to the current behaviour — deleting
// or corrupting the doc leaves AI fully working on defaults.

// The four AI roles flows are bucketed into. Free-text model names per role for
// now (no live catalog yet); a later phase adds validation against a catalog.
export const AI_MODEL_ROLES = ['fast', 'pro', 'embedding', 'image'] as const;
export type AiModelRole = (typeof AI_MODEL_ROLES)[number];

// Today's exact production model literals — the fallback for every role. These
// MUST stay in sync with the hardcoded literals the flows used before Phase 1.
export const AI_MODEL_DEFAULTS = {
  fast: 'gemini-flash-latest',
  pro: 'gemini-pro-latest',
  embedding: 'gemini-embedding-001',
  image: 'gemini-2.5-flash-image',
} as const satisfies Record<AiModelRole, string>;

export const AppSettingsSchema = z.object({
  fast: z.string().min(1).default(AI_MODEL_DEFAULTS.fast),
  pro: z.string().min(1).default(AI_MODEL_DEFAULTS.pro),
  embedding: z.string().min(1).default(AI_MODEL_DEFAULTS.embedding),
  image: z.string().min(1).default(AI_MODEL_DEFAULTS.image),
  schemaVersion: z.literal(1).default(1),
  // Audit metadata: who last changed the doc and when (ms epoch). Optional so a
  // never-configured / defaulted doc still parses; the UI shows them when set.
  updatedAt: z.number().optional(),
  updatedBy: z.string().optional(),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
