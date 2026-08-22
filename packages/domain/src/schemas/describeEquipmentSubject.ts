import { z } from 'zod';

// Input/output for the describeEquipmentSubject flow (equipment pictogram
// art-direction, issue #877).
//
// A cheap text step in front of the expensive image step: a fast model turns a
// make and model — "Kenwood Chef KVC3100S" — into a sentence saying what the
// thing LOOKS like, and that sentence is what makes the drawing recognisably
// that device rather than a generic cartoon of its type.
//
// These schemas live here rather than beside the flow (issue #885) because the
// flow is now also a CALLABLE: its input is a trust boundary, and the Zod
// conventions put every schema at a trust boundary in `@salt/domain/schemas`.
// The arrangement mirrors `describeRecipeScene.ts`, which is the same flow shape
// for the recipe hero.
export const DescribeEquipmentSubjectInputSchema = z.object({
  // The equipment item's name, verbatim from the manifest. By contract this
  // already carries the make and model (identifyEquipment.ts's system rule 1),
  // so there is no separate make/model field to read and none should be added.
  name: z.string().min(1),
  // ─── Revision mode (issue #885) ───────────────────────────────────────────
  // Both OPTIONAL and ADDITIVE, exactly as DescribeRecipeSceneInputSchema: omit
  // both and the flow authors from scratch — the original behaviour, what the
  // manifest trigger sends, and also what "Start over" deliberately sends (a
  // fresh description from the item's name, discarding accumulated edits).
  // Supply both and the flow REVISES `currentBrief` per `hint` instead.
  //
  // The NAME stays required in revision mode on purpose, for the same reason the
  // recipe stays required there: revising prose about an appliance without
  // knowing which appliance it describes drifts away from the actual device,
  // which is the exact failure the whole brief step exists to fix.
  //
  // Caps mirror the recipe schema — 2000 for the brief (the same paragraph
  // round-trips through the textarea's own maxLength), 200 for the steer.
  currentBrief: z.string().trim().max(2000).optional(),
  // Additive steer, folded into the brief. Never alters the flow's scope rules:
  // house style, prohibitions and the brand ban are locked in Cloud Functions
  // code and are not something a steer can vote on.
  hint: z.string().trim().max(200).optional(),
});

export type DescribeEquipmentSubjectInput = z.infer<typeof DescribeEquipmentSubjectInputSchema>;

// One prose sentence, deliberately NOT a structured object ({ silhouette,
// colour, controls, … }): it is written to be read and edited by a human in a
// textarea, and handed to the image model as prose. The wrapper object exists
// only because Genkit structured output needs one — `brief` is the payload.
export const DescribeEquipmentSubjectOutputSchema = z.object({
  brief: z.string().min(1),
});

export type DescribeEquipmentSubjectOutput = z.infer<typeof DescribeEquipmentSubjectOutputSchema>;
