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

// Phase 2: per-flow model overrides. Every AI flow (and the server embedding
// adapter) maps to exactly one role; this is the single source of truth for that
// mapping, shared by the CF resolver and the admin UI. A flow inherits its
// role's model unless an admin sets an explicit override in `perFlow`.
//
// IMPORTANT: these flow-id keys are stable identifiers persisted in the
// `perFlow` map of the production `appSettings` doc — renaming one orphans any
// saved override. Add new flows here; do not rename existing ones.
export const AI_FLOW_ROLES = {
  arbitrateCanon: 'fast',
  authorRecipe: 'fast',
  chefChat: 'pro',
  embedText: 'embedding',
  extractRecipeFromUrl: 'fast',
  generateCanonIcon: 'image',
  generateChatTitle: 'fast',
  identifyEquipment: 'fast',
  parseEntry: 'fast',
  parseRecipeIngredients: 'fast',
  populateEquipmentEntry: 'fast',
  serverEmbedding: 'embedding',
} as const satisfies Record<string, AiModelRole>;

export type AiFlowId = keyof typeof AI_FLOW_ROLES;
export const AI_FLOW_IDS = Object.keys(AI_FLOW_ROLES) as AiFlowId[];

export const AppSettingsSchema = z.object({
  fast: z.string().min(1).default(AI_MODEL_DEFAULTS.fast),
  pro: z.string().min(1).default(AI_MODEL_DEFAULTS.pro),
  embedding: z.string().min(1).default(AI_MODEL_DEFAULTS.embedding),
  image: z.string().min(1).default(AI_MODEL_DEFAULTS.image),
  schemaVersion: z.literal(1).default(1),
  // Phase 2: optional per-flow overrides (flow-id → model name). Absent means
  // "no overrides" — every flow inherits its role's model — so a Phase 1 doc
  // with no `perFlow` field parses unchanged (back-compat on read). Keys are
  // free-form strings so an unknown/retired flow-id in a stored doc never fails
  // the parse; the resolver only reads the key for the flow it asks about. Each
  // value is a non-empty model name — clearing an override drops the key
  // entirely rather than storing an empty string.
  perFlow: z.record(z.string(), z.string().min(1)).optional(),
  // Audit metadata: who last changed the doc and when (ms epoch). Optional so a
  // never-configured / defaulted doc still parses; the UI shows them when set.
  updatedAt: z.number().optional(),
  updatedBy: z.string().optional(),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
