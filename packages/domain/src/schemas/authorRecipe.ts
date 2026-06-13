import { z } from 'zod';
import { MessageSchema } from './chatSession.js';

// Input to the librarian (authorRecipe) flow: the full conversation that the
// user wants to turn into a recipe (issue #206, Phase 4).
export const AuthorRecipeInputSchema = z.object({
  messages: z.array(MessageSchema),
});

export type AuthorRecipeInput = z.infer<typeof AuthorRecipeInputSchema>;

// The shape the AI model emits inside the flow (never leaves the CF boundary).
// The model uses 0-based step ordinals for ingredient links; the flow resolves
// them to step IDs before returning the final RecipeDoc to the client.
export const LibrarianIngredientSchema = z.object({
  rawText: z.string(),
  isOptional: z.boolean(),
  // Index into the steps array (0-based) for the step where this ingredient
  // is first used. null = no specific step assignment.
  firstUsedInStepOrdinal: z.number().int().nullable(),
});

export const LibrarianGroupSchema = z.object({
  name: z.string().nullable(),
  ingredients: z.array(LibrarianIngredientSchema),
});

export const LibrarianStepSchema = z.object({
  text: z.string(),
  timerMinutes: z.number().int().nullable(),
  note: z.string().nullable(),
});

export const LibrarianOutputSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number().nullable(),
  totalTimeMinutes: z.number().nullable(),
  prepTimeMinutes: z.number().nullable(),
  cookTimeMinutes: z.number().nullable(),
  tags: z.array(z.string()),
  ingredientGroups: z.array(LibrarianGroupSchema),
  steps: z.array(LibrarianStepSchema),
  notes: z.string().nullable(),
});

export type AuthorRecipeInput_ = z.infer<typeof AuthorRecipeInputSchema>;
export type LibrarianIngredient = z.infer<typeof LibrarianIngredientSchema>;
export type LibrarianGroup = z.infer<typeof LibrarianGroupSchema>;
export type LibrarianStep = z.infer<typeof LibrarianStepSchema>;
export type LibrarianOutput = z.infer<typeof LibrarianOutputSchema>;
