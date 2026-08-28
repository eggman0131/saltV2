export {
  ArbitrationRequestSchema,
  ArbitrationResultSchema,
  CanonArbitrationAIOutputSchema,
} from './canonArbitration.js';
export type { ArbitrationResult } from './canonArbitration.js';

export {
  ProductFormArbitrationRequestSchema,
  ProductFormArbitrationAIOutputSchema,
  ProductFormProposalSchema,
} from './productFormArbitration.js';
export type {
  ProductFormArbitrationRequest,
  ProductFormProposal,
} from './productFormArbitration.js';

export { EmbedTextInputSchema } from './embedTextInput.js';
export {
  IdentifyEquipmentAIOutputSchema,
  IdentifyEquipmentInputSchema,
} from './identifyEquipment.js';
export { ParseEntryAIOutputSchema } from './parseEntry.js';
export {
  PopulateEquipmentEntryAIOutputSchema,
  PopulateEquipmentEntryInputSchema,
} from './populateEquipmentEntry.js';
export { MatchOrCreateCanonInputSchema } from './matchOrCreateCanonInput.js';
// Browser→CF trace-continuity wire envelopes (issue #362): the base callable
// input + an optional, named, typed `traceparent` transport field. The CF
// entrypoint validates these, strips `traceparent`, and passes the pure domain
// input to the flow — flows never consume the field (domain purity).
export {
  MatchOrCreateCanonWireInputSchema,
  CanonicaliseRecipeIngredientsWireInputSchema,
  AuthorRecipeWireInputSchema,
  ExtractRecipeFromUrlWireInputSchema,
  ExtractRecipeFromPhotoWireInputSchema,
  IdentifyEquipmentWireInputSchema,
  PopulateEquipmentEntryWireInputSchema,
  RefreshWeatherForecastWireInputSchema,
  DescribeRecipeSceneWireInputSchema,
} from './traceContextWire.js';
export { WeatherForecastSchema, OpenMeteoForecastResponseSchema } from './weatherForecast.js';
export type {
  WeatherDaySummary,
  WeatherForecast,
  RefreshWeatherForecastInput,
  OpenMeteoForecastResponse,
} from './weatherForecast.js';

export { CanonicaliseRecipeIngredientsInputSchema } from './canonicaliseRecipeIngredientsInput.js';
export type { CanonicaliseRecipeIngredientsInput } from './canonicaliseRecipeIngredientsInput.js';

export { RegenerateCanonIconInputSchema } from './regenerateCanonIcon.js';
export { RegenerateProductFormIconInputSchema } from './regenerateProductFormIcon.js';
export { RegenerateRecipeImageInputSchema } from './regenerateRecipeImage.js';
export { RedoRecipeKitInputSchema } from './redoRecipeKit.js';
// Your own picture in place of a generated pictogram (issue #892). Recipe heroes
// keep their own upload above — a 3:2 hero and a 128px square are two pipelines.
export { SetIconUploadInputSchema } from './setIconUpload.js';
export type { IconUploadFamily, SetIconUploadInput } from './setIconUpload.js';

// The prompt behind any generated picture (issue #892) — re-derived on demand
// from the document by the same builders the generators use, never persisted.
export {
  IMAGE_PROMPT_FAMILIES,
  GetImagePromptInputSchema,
  GetImagePromptResultSchema,
} from './getImagePrompt.js';
export type {
  ImagePromptFamily,
  GetImagePromptInput,
  GetImagePromptResult,
} from './getImagePrompt.js';

export { SetRecipeImageUploadInputSchema } from './setRecipeImageUpload.js';
// The observation photo (issue #812, phase 4) — the same shape one level deeper:
// two ids, because the object lives at `batch-images/{batchId}/{observationId}`.
export { SetObservationImageUploadInputSchema } from './setObservationImageUpload.js';
export type { SetObservationImageUploadInput } from './setObservationImageUpload.js';

export { CanonItemSchema } from './canonItem.js';
export type { CanonItemDoc } from './canonItem.js';

export { ProductFormSchema } from './productForm.js';
export type { ProductFormDoc } from './productForm.js';

export { CanonEmbeddingSchema } from './canonEmbedding.js';
export { AislesDocumentSchema } from './aislesDocument.js';
export { CanonPurchaseCountsSchema } from './canonPurchaseCounts.js';
export type { CanonPurchaseCountsDoc } from './canonPurchaseCounts.js';

export {
  AccessorySchema,
  EquipmentItemSchema,
  EquipmentManifestSchema,
  EQUIPMENT_MANIFEST_COLLECTION,
  EQUIPMENT_MANIFEST_DOC_ID,
} from './equipmentManifest.js';
export type { EquipmentItemDoc } from './equipmentManifest.js';

export {
  EquipmentIconSchema,
  DrawEquipmentIconInputSchema,
  EQUIPMENT_ICONS_COLLECTION,
} from './equipmentIcon.js';
export type { EquipmentIconDoc, DrawEquipmentIconInput } from './equipmentIcon.js';

export { ShoppingListSchema } from './shoppingList.js';
export { ShoppingListItemSchema } from './shoppingListItem.js';
export { ShoppingListsConfigSchema } from './shoppingListsConfig.js';
export { ShoppingDaySchema } from './shoppingDay.js';
export type { ShoppingSlot, ShoppingDayDoc } from './shoppingDay.js';

export { KitchenMemorySchema, KITCHEN_MEMORY_COLLECTION } from './kitchenMemory.js';
export type { KitchenMemoryDoc } from './kitchenMemory.js';

// Generic kitchen tools (issue #882) — the curated pictogram vocabulary that a
// recipe's or a plan's WORDS are resolved against at display time. Nothing stores
// one of these ids, which is what makes the list free to grow.
export { KitchenToolSchema, KITCHEN_TOOLS_COLLECTION } from './kitchenTool.js';
export type { KitchenToolDoc } from './kitchenTool.js';

export { DevSettingsSchema } from './devSettings.js';
export type { DevSettingsDoc } from './devSettings.js';

export {
  AppSettingsSchema,
  parseNominatimResponse,
  parseNominatimReverse,
  AI_MODEL_DEFAULTS,
  AI_MODEL_ROLES,
  AI_FLOW_ROLES,
  AI_FLOW_IDS,
} from './appSettings.js';
export type {
  AppSettings,
  HomeLocation,
  GeocodingResult,
  AiModelRole,
  AiFlowId,
} from './appSettings.js';

export { MemberSchema } from './member.js';
export { MealPlanConfigSchema } from './mealPlanConfig.js';
export { MealPlanTemplateSchema } from './mealPlanTemplate.js';
export { MealPlanWeekSchema } from './mealPlanWeek.js';
export {
  ParseRecipeIngredientsInputSchema,
  ParseRecipeIngredientsAIOutputSchema,
  ParseRecipeIngredientsOutputSchema,
} from './parseRecipeIngredients.js';
export { MessageSchema, ChatSessionSchema } from './chatSession.js';
export type { ChatSessionDoc } from './chatSession.js';

export { CookSessionSchema } from './cookSession.js';
export type { CookActiveTimerDoc, CookSessionDoc } from './cookSession.js';

export { KitchenTimersSchema } from './kitchenTimer.js';
export type { KitchenTimerDoc, KitchenTimersDoc } from './kitchenTimer.js';

// Guided plan (issue #751) — the per-recipe prep list + step notes, stored in
// its own family-shared collection and deliberately NOT on RecipeSchema.
export {
  GuidedPlanSchema,
  GenerateGuidedPlanInputSchema,
  GenerateGuidedPlanAIOutputSchema,
  GenerateGuidedPlanOutputSchema,
} from './guidedPlan.js';
export type {
  GuidedPrepEntryDoc,
  GuidedStepNoteDoc,
  GuidedPlanDoc,
  GenerateGuidedPlanInput,
  GenerateGuidedPlanOutput,
} from './guidedPlan.js';

export { EmailOtpRequestSchema, EmailOtpVerifySchema, PendingEmailOtpSchema } from './emailOtp.js';
export type { PendingEmailOtp } from './emailOtp.js';

export { PushSubscriptionSchema } from './pushSubscription.js';
export type { PushSubscriptionDoc } from './pushSubscription.js';

export { ChefChatInputSchema } from './chefChat.js';
export type { ChefChatInput } from './chefChat.js';

// identifyRecipeKit (issue #882) — "what do I need to get out?", inferred from the
// whole stored recipe. Labels are FREE TEXT on purpose; read the header before
// reaching for an enum over the drawn vocabulary.
export {
  IdentifyRecipeKitInputSchema,
  IdentifyRecipeKitAIOutputSchema,
  IdentifyRecipeKitOutputSchema,
} from './identifyRecipeKit.js';
export type { IdentifyRecipeKitInput } from './identifyRecipeKit.js';

// estimateRecipeTimes (issue #952, phase 2) — "how long does this ACTUALLY take?",
// re-asked of a recipe already in the library against the definition phase 1 put
// in recipeFieldRules. It answers three numbers and touches nothing else.
export {
  EstimateRecipeTimesInputSchema,
  EstimateRecipeTimesAIOutputSchema,
  EstimateRecipeTimesOutputSchema,
} from './estimateRecipeTimes.js';
export type { EstimateRecipeTimesInput, EstimateRecipeTimesOutput } from './estimateRecipeTimes.js';

export {
  CategoriseRecipeInputSchema,
  CategoriseRecipeAIOutputSchema,
  CategoriseRecipeOutputSchema,
} from './categoriseRecipe.js';
export {
  DescribeRecipeSceneInputSchema,
  DescribeRecipeSceneOutputSchema,
} from './describeRecipeScene.js';
export type { DescribeRecipeSceneInput, DescribeRecipeSceneOutput } from './describeRecipeScene.js';

export {
  DescribeEquipmentSubjectInputSchema,
  DescribeEquipmentSubjectOutputSchema,
} from './describeEquipmentSubject.js';
export type {
  DescribeEquipmentSubjectInput,
  DescribeEquipmentSubjectOutput,
} from './describeEquipmentSubject.js';

export { AuthorRecipeInputSchema, LibrarianOutputSchema } from './authorRecipe.js';
export type { AuthorRecipeInput, LibrarianOutput } from './authorRecipe.js';

export {
  ExtractRecipeFromUrlInputSchema,
  ExtractRecipeAIOutputSchema,
  URL_IMPORT_FAILURE_CODES,
} from './extractRecipeFromUrl.js';
export type {
  ExtractRecipeFromUrlInput,
  ExtractRecipeAIOutput,
  UrlImportFailureCode,
} from './extractRecipeFromUrl.js';

export {
  ExtractRecipeFromPhotoInputSchema,
  ExtractRecipeFromPhotoAIOutputSchema,
  MAX_RECIPE_PAGE_PHOTOS,
  PHOTO_IMPORT_TIMEOUT_SECONDS,
  PHOTO_IMPORT_FAILURE_CODES,
} from './extractRecipeFromPhoto.js';
export type {
  ExtractRecipeFromPhotoInput,
  ExtractRecipeFromPhotoAIOutput,
  RecipePagePhoto,
  PhotoImportFailureCode,
} from './extractRecipeFromPhoto.js';

export { isImportError } from './importFailure.js';
export type { UrlImportFailure, PhotoImportFailure } from './importFailure.js';

export { RecipeKindSchema, RecipeSchema } from './recipe.js';
export type {
  QuantityDoc,
  IngredientDoc,
  IngredientGroupDoc,
  StepTimerDoc,
  StepDoc,
  RecipeSourceDoc,
  RecipeKitEntryDoc,
  RecipeDoc,
} from './recipe.js';

// `RecipeDiffSchema` is exported alongside the type it derives: it is the source
// of truth for `RecipeDiff` (schema-first, CLAUDE.md), and a type-only export
// would leave the zod unreachable at runtime.
export { RecipeDiffSchema } from './recipeDiff.js';
export type { NullableStringChange, StepChange, RecipeDiff } from './recipeDiff.js';

// Formula module (issue #782) — composition as ratios against a declared basis.
// Written to `formulas/{recipeId}` since issue #806; the shape is unchanged from
// #782, which landed the schema alongside the pure arithmetic typed against it.
export { FormulaSchema } from './formula.js';
export type { FormulaComponent, ReferenceYield, Formula } from './formula.js';

// Process (issue #806, phase 2) — the ordered stages hanging off a formula, and
// the extraction flow that authors them. `active` vs `wait` is DEFINED in
// process.ts's field docs and repeated verbatim in the flow's prompt; read it
// before changing either.
export {
  ProcessStageKindSchema,
  StageDurationSchema,
  ExtractProcessStagesInputSchema,
  ExtractProcessStagesAIOutputSchema,
  ExtractProcessStagesOutputSchema,
} from './process.js';
export type {
  ProcessStageKind,
  StageEnvironment,
  StageDuration,
  ProcessStage,
  Process,
  ExtractProcessStagesInput,
  ExtractProcessStagesOutput,
} from './process.js';

// proposeSchedule (issue #812, phase 2) — the PROPOSAL tier. Restructures a
// formula's reference process to land at a target time and says why, in words. It
// emits NO timestamps and NO grams: `resolveSchedule` computes the clock and
// `solveFormula` computes the weights, and the leavening opinion crosses as a
// multiplicative factor rather than a number. The three timeout constants are
// shared with the CF and the callable wrapper so they cannot drift.
export {
  PROPOSE_SCHEDULE_TIMEOUT_SECONDS,
  PROPOSE_SCHEDULE_CLIENT_TIMEOUT_MS,
  PROPOSE_SCHEDULE_AI_TIMEOUT_MS,
  DEFAULT_QUIET_HOURS,
  ProposeScheduleInputSchema,
  ProposedStageSchema,
  ProposeScheduleAIOutputSchema,
  ProposeScheduleOutputSchema,
} from './proposeSchedule.js';
export type {
  QuietHours,
  ProposeScheduleInput,
  ProposedStage,
  ComponentAdjustment,
  ProposeScheduleOutput,
} from './proposeSchedule.js';

// Process diff (issue #812, phase 2) — the render contract for reviewing a
// proposed restructure. NEVER persisted, so there is no back-compat surface, and
// there is deliberately no `split`: one stage becoming two is a removal plus two
// additions. `recipeDiff` is the precedent.
export { ProcessDiffSchema } from './processDiff.js';
export type { ProcessStageDiffEntry, ProcessDiff } from './processDiff.js';

// Batch (issue #812, phase 1) — ONE RUN at `batches/{batchId}`, family-shared with
// a random id. Everything on it is FROZEN at start: resolved grams AND their
// labels, the resolved totals, and the resolved schedule. Read batch.ts's header
// before adding a field — the reason the document repeats what the recipe and the
// formula already say is the whole point of it.
export { BatchStateSchema, BatchSchema, BatchObservationSchema } from './batch.js';
export type {
  BatchQuantityDoc,
  BatchTotalsDoc,
  BatchStageDoc,
  BatchDoc,
  BatchObservationDoc,
} from './batch.js';
