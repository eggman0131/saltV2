import { z } from 'zod';

// Input/output for the describeRecipeScene flow (recipe hero art-direction).
// A cheap text step in front of the expensive image step: a fast model reads the
// WHOLE recipe — not just the title/description the image prompt used to see —
// and writes a short art-direction brief describing what the plated dish actually
// looks like and how it reads in mood/season/cuisine. That brief then directs the
// image model in place of the "work it out yourself" clause.
//
// The input mirrors CategoriseRecipeInputSchema: both flows read the same recipe
// content, they just answer different questions about it.
export const DescribeRecipeSceneInputSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  // Ingredient display lines (rawText). The whole point of this flow: a garnish
  // or a finishing ingredient that appears ONLY here is exactly the detail the
  // title/description-only prompt could never see.
  ingredients: z.array(z.string()),
  // Method text. Carries the finished-appearance cues ("grill until blistered
  // and golden", "scatter with torn basil") that decide how the dish looks.
  steps: z.array(z.string()).optional().default([]),
});

export type DescribeRecipeSceneInput = z.infer<typeof DescribeRecipeSceneInputSchema>;

// The brief round-trips as ONE PROSE BLOB, deliberately NOT a structured object
// ({ plating, vessel, garnish, … }). It is written to be read and edited by a
// human as a paragraph, and it is handed to the image model as prose, so
// decomposing it would only add a shape to keep in sync with no consumer for the
// parts. The wrapper object exists solely because Genkit structured output needs
// one — `brief` itself is the payload.
export const DescribeRecipeSceneOutputSchema = z.object({
  brief: z.string(),
});

export type DescribeRecipeSceneOutput = z.infer<typeof DescribeRecipeSceneOutputSchema>;
