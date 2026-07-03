import type { StepDoc, StepTimerDoc } from '../../schemas/recipe.js';

// A recipe step and its optional timer (issue #179). Schema-first (issue #417):
// aliases of the inferred `StepSchema`/`StepTimerSchema` types — the schemas in
// `@salt/domain/schemas` are the single source of truth. `note` is a manual,
// hand-authored field the AI may populate in the deferred AI epic.
export type StepTimer = StepTimerDoc;
export type Step = StepDoc;
