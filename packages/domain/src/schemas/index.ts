export {
  ArbitrationRequestSchema,
  ArbitrationResultSchema,
  CanonArbitrationAIOutputSchema,
} from './canonArbitration.js';
export type {
  ArbitrationRequestInput,
  ArbitrationResult,
  CanonArbitrationAIOutput,
} from './canonArbitration.js';

export {
  ProductFormArbitrationRequestSchema,
  ProductFormArbitrationAIOutputSchema,
  ProductFormProposalSchema,
} from './productFormArbitration.js';
export type {
  ProductFormArbitrationRequest,
  ProductFormArbitrationAIOutput,
  ProductFormProposal,
} from './productFormArbitration.js';

export { EmbedTextInputSchema } from './embedTextInput.js';
export type { EmbedTextInput } from './embedTextInput.js';

export {
  EquipmentCandidateSchema,
  IdentifyEquipmentAIOutputSchema,
  IdentifyEquipmentInputSchema,
} from './identifyEquipment.js';
export type {
  EquipmentCandidate,
  IdentifyEquipmentAIOutput,
  IdentifyEquipmentInput,
} from './identifyEquipment.js';

export { ParseEntryAIOutputSchema } from './parseEntry.js';
export type { ParseEntryAIOutput } from './parseEntry.js';

export {
  EquipmentAccessorySchema,
  PopulateEquipmentEntryAIOutputSchema,
  PopulateEquipmentEntryInputSchema,
} from './populateEquipmentEntry.js';
export type {
  EquipmentAccessory,
  PopulateEquipmentEntryAIOutput,
  PopulateEquipmentEntryInput,
} from './populateEquipmentEntry.js';

export { MatchOrCreateCanonInputSchema } from './matchOrCreateCanonInput.js';
export type { MatchOrCreateCanonInput } from './matchOrCreateCanonInput.js';

// Browser→CF trace-continuity wire envelopes (issue #362): the base callable
// input + an optional, named, typed `traceparent` transport field. The CF
// entrypoint validates these, strips `traceparent`, and passes the pure domain
// input to the flow — flows never consume the field (domain purity).
export {
  TraceparentSchema,
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
export type {
  MatchOrCreateCanonWireInput,
  CanonicaliseRecipeIngredientsWireInput,
  AuthorRecipeWireInput,
  ExtractRecipeFromUrlWireInput,
  ExtractRecipeFromPhotoWireInput,
  IdentifyEquipmentWireInput,
  PopulateEquipmentEntryWireInput,
  RefreshWeatherForecastWireInput,
  DescribeRecipeSceneWireInput,
} from './traceContextWire.js';

export {
  WeatherDaySummarySchema,
  WeatherForecastSchema,
  RefreshWeatherForecastInputSchema,
  OpenMeteoForecastResponseSchema,
} from './weatherForecast.js';
export type {
  WeatherDaySummary,
  WeatherForecast,
  RefreshWeatherForecastInput,
  OpenMeteoForecastResponse,
} from './weatherForecast.js';

export {
  CanonicaliseRecipeIngredientsItemSchema,
  CanonicaliseRecipeIngredientsInputSchema,
} from './canonicaliseRecipeIngredientsInput.js';
export type {
  CanonicaliseRecipeIngredientsItem,
  CanonicaliseRecipeIngredientsInput,
} from './canonicaliseRecipeIngredientsInput.js';

export { RegenerateCanonIconInputSchema } from './regenerateCanonIcon.js';
export { RegenerateProductFormIconInputSchema } from './regenerateProductFormIcon.js';
export type { RegenerateCanonIconInput } from './regenerateCanonIcon.js';

export { RegenerateRecipeImageInputSchema } from './regenerateRecipeImage.js';
export type { RegenerateRecipeImageInput } from './regenerateRecipeImage.js';

export { SetRecipeImageUploadInputSchema } from './setRecipeImageUpload.js';
export type { SetRecipeImageUploadInput } from './setRecipeImageUpload.js';

// The observation photo (issue #812, phase 4) — the same shape one level deeper:
// two ids, because the object lives at `batch-images/{batchId}/{observationId}`.
export { SetObservationImageUploadInputSchema } from './setObservationImageUpload.js';
export type { SetObservationImageUploadInput } from './setObservationImageUpload.js';

export { CanonItemSchema, PendingCanonChangeSchema } from './canonItem.js';
export type { CanonItemDoc, PendingCanonChangeDoc } from './canonItem.js';

export { ProductFormSchema } from './productForm.js';
export type { ProductFormDoc } from './productForm.js';

export { CanonEmbeddingSchema } from './canonEmbedding.js';
export type { CanonEmbeddingDoc } from './canonEmbedding.js';

export { AisleSchema, AislesDocumentSchema } from './aislesDocument.js';
export type { AisleDoc, AislesDocumentDoc } from './aislesDocument.js';

export { CanonPurchaseCountsSchema } from './canonPurchaseCounts.js';
export type { CanonPurchaseCountsDoc } from './canonPurchaseCounts.js';

export {
  AccessorySchema,
  EquipmentItemSchema,
  EquipmentManifestSchema,
  EQUIPMENT_MANIFEST_COLLECTION,
  EQUIPMENT_MANIFEST_DOC_ID,
} from './equipmentManifest.js';
export type { AccessoryDoc, EquipmentItemDoc, EquipmentManifestDoc } from './equipmentManifest.js';

export { ShoppingListSchema } from './shoppingList.js';
export type { ShoppingListDoc } from './shoppingList.js';

export { SourceRefSchema, ShoppingListItemSchema } from './shoppingListItem.js';
export type { SourceRefDoc, ShoppingListItemDoc } from './shoppingListItem.js';

export { ShoppingListsConfigSchema } from './shoppingListsConfig.js';
export type { ShoppingListsConfigDoc } from './shoppingListsConfig.js';

export { ShoppingSlotSchema, ShoppingDaySchema } from './shoppingDay.js';
export type { ShoppingSlot, ShoppingDayDoc } from './shoppingDay.js';

export { KitchenMemorySchema, KITCHEN_MEMORY_COLLECTION } from './kitchenMemory.js';
export type { KitchenMemoryDoc } from './kitchenMemory.js';

export { DevSettingsSchema } from './devSettings.js';
export type { DevSettingsDoc } from './devSettings.js';

export {
  AppSettingsSchema,
  HomeLocationSchema,
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
export type { MemberDoc } from './member.js';

export { WeekdayEnum, AttendeeSchema, MealPlanDaySchema } from './mealPlanDay.js';
export type { WeekdayDoc, AttendeeDoc, MealPlanDayDoc } from './mealPlanDay.js';

export { MealPlanConfigSchema } from './mealPlanConfig.js';
export type { MealPlanConfigDoc } from './mealPlanConfig.js';

export { MealPlanTemplateSchema } from './mealPlanTemplate.js';
export type { MealPlanTemplateDoc } from './mealPlanTemplate.js';

export { MealPlanWeekSchema } from './mealPlanWeek.js';
export type { MealPlanWeekDoc } from './mealPlanWeek.js';

export {
  ParseRecipeIngredientsInputSchema,
  ParseRecipeIngredientsAIOutputSchema,
  ParseRecipeIngredientsOutputSchema,
} from './parseRecipeIngredients.js';
export type {
  ParseRecipeIngredientsInput,
  ParseRecipeIngredientsAIOutput,
  ParseRecipeIngredientsOutput,
} from './parseRecipeIngredients.js';

export { MessageSchema, ChatSessionSchema } from './chatSession.js';
export type { MessageDoc, ChatSessionDoc } from './chatSession.js';

export { CookActiveTimerSchema, CookSessionSchema } from './cookSession.js';
export type { CookActiveTimerDoc, CookSessionDoc } from './cookSession.js';

export { KitchenTimerSchema, KitchenTimersSchema } from './kitchenTimer.js';
export type { KitchenTimerDoc, KitchenTimersDoc } from './kitchenTimer.js';

// Guided plan (issue #751) — the per-recipe prep list + step notes, stored in
// its own family-shared collection and deliberately NOT on RecipeSchema.
export {
  GuidedCheckInSchema,
  GuidedPrepEntryContentSchema,
  GuidedStepNoteContentSchema,
  GuidedPrepEntrySchema,
  GuidedStepNoteSchema,
  GuidedPlanSchema,
  GenerateGuidedPlanInputSchema,
  GenerateGuidedPlanAIOutputSchema,
  GenerateGuidedPlanOutputSchema,
} from './guidedPlan.js';
export type {
  GuidedCheckInDoc,
  GuidedPrepEntryDoc,
  GuidedStepNoteDoc,
  GuidedPlanDoc,
  GenerateGuidedPlanInput,
  GenerateGuidedPlanAIOutput,
  GenerateGuidedPlanOutput,
} from './guidedPlan.js';

export { EmailOtpRequestSchema, EmailOtpVerifySchema, PendingEmailOtpSchema } from './emailOtp.js';
export type { EmailOtpRequest, EmailOtpVerify, PendingEmailOtp } from './emailOtp.js';

export { PushSubscriptionSchema } from './pushSubscription.js';
export type { PushSubscriptionDoc } from './pushSubscription.js';

export { ChefChatInputSchema } from './chefChat.js';
export type { ChefChatInput } from './chefChat.js';

export {
  CategoriseRecipeInputSchema,
  CategoriseRecipeAIOutputSchema,
  CategoriseRecipeOutputSchema,
} from './categoriseRecipe.js';
export type {
  CategoriseRecipeInput,
  CategoriseRecipeAIOutput,
  CategoriseRecipeOutput,
} from './categoriseRecipe.js';

export {
  DescribeRecipeSceneInputSchema,
  DescribeRecipeSceneOutputSchema,
} from './describeRecipeScene.js';
export type { DescribeRecipeSceneInput, DescribeRecipeSceneOutput } from './describeRecipeScene.js';

export { AuthorRecipeInputSchema, LibrarianOutputSchema } from './authorRecipe.js';
export type {
  AuthorRecipeInput,
  LibrarianOutput,
  LibrarianGroup,
  LibrarianIngredient,
  LibrarianStep,
} from './authorRecipe.js';

export {
  ExtractRecipeFromUrlInputSchema,
  ExtractRecipeFromUrlOutputSchema,
  ExtractRecipeAIOutputSchema,
  ExtractedIngredientSchema,
  ExtractedIngredientGroupSchema,
  ExtractedStepSchema,
  URL_IMPORT_FAILURE_CODES,
} from './extractRecipeFromUrl.js';
export type {
  ExtractRecipeFromUrlInput,
  ExtractRecipeFromUrlOutput,
  ExtractRecipeAIOutput,
  ExtractedIngredient,
  ExtractedIngredientGroup,
  ExtractedStep,
  UrlImportFailureCode,
} from './extractRecipeFromUrl.js';

export {
  ExtractRecipeFromPhotoInputSchema,
  ExtractRecipeFromPhotoOutputSchema,
  ExtractRecipeFromPhotoAIOutputSchema,
  ExtractedBookSourceSchema,
  RecipePagePhotoSchema,
  RECIPE_PAGE_PHOTO_CONTENT_TYPES,
  MAX_RECIPE_PAGE_PHOTOS,
  PHOTO_IMPORT_TIMEOUT_SECONDS,
  PHOTO_IMPORT_FAILURE_CODES,
} from './extractRecipeFromPhoto.js';
export type {
  ExtractRecipeFromPhotoInput,
  ExtractRecipeFromPhotoOutput,
  ExtractRecipeFromPhotoAIOutput,
  ExtractedBookSource,
  RecipePagePhoto,
  RecipePagePhotoContentType,
  PhotoImportFailureCode,
} from './extractRecipeFromPhoto.js';

export { isImportError } from './importFailure.js';
export type { ImportFailure, UrlImportFailure, PhotoImportFailure } from './importFailure.js';

export {
  SingleQuantitySchema,
  RangeQuantitySchema,
  MixedQuantitySchema,
  QuantitySchema,
  ParsedIngredientSchema,
  IngredientSchema,
  IngredientGroupSchema,
  StepTimerSchema,
  StepSchema,
  RecipeMetadataSchema,
  RecipeSourceSchema,
  RecipeImageSchema,
  RecipeKindSchema,
  RecipeSchema,
} from './recipe.js';
export type {
  SingleQuantityDoc,
  RangeQuantityDoc,
  MixedQuantityDoc,
  QuantityDoc,
  ParsedIngredientDoc,
  IngredientDoc,
  IngredientGroupDoc,
  StepTimerDoc,
  StepDoc,
  RecipeMetadataDoc,
  RecipeSourceDoc,
  RecipeImageDoc,
  RecipeKindDoc,
  RecipeDoc,
} from './recipe.js';

export {
  RecipeFieldChangeSchema,
  NullableStringChangeSchema,
  NullableNumberChangeSchema,
  IngredientDiffEntrySchema,
  IngredientChangeSchema,
  IngredientsDiffSchema,
  StepTimerChangeSchema,
  StepDiffEntrySchema,
  StepChangeSchema,
  StepsDiffSchema,
  RecipeMetadataDiffSchema,
  TagsDiffSchema,
  RecipeDiffSchema,
} from './recipeDiff.js';
export type {
  RecipeFieldChange,
  NullableStringChange,
  NullableNumberChange,
  IngredientDiffEntry,
  IngredientChange,
  IngredientsDiff,
  StepTimerChange,
  StepDiffEntry,
  StepChange,
  StepsDiff,
  RecipeMetadataDiff,
  TagsDiff,
  RecipeDiff,
} from './recipeDiff.js';

// Formula module (issue #782) — composition as ratios against a declared basis.
// Written to `formulas/{recipeId}` since issue #806; the shape is unchanged from
// #782, which landed the schema alongside the pure arithmetic typed against it.
export {
  DensityClassSchema,
  FormulaComponentSchema,
  UnitShapeSchema,
  ReferenceYieldSchema,
  FormulaSchema,
} from './formula.js';
export type {
  DensityClass,
  FormulaComponent,
  UnitShape,
  ReferenceYield,
  Formula,
} from './formula.js';

// Process (issue #806, phase 2) — the ordered stages hanging off a formula, and
// the extraction flow that authors them. `active` vs `wait` is DEFINED in
// process.ts's field docs and repeated verbatim in the flow's prompt; read it
// before changing either.
export {
  ProcessStageKindSchema,
  StageEnvironmentSchema,
  StageDurationSchema,
  ProcessStageContentSchema,
  ProcessStageSchema,
  ProcessSchema,
  ExtractProcessStagesInputSchema,
  ExtractProcessStagesAIOutputSchema,
  ExtractProcessStagesOutputSchema,
} from './process.js';
export type {
  ProcessStageKind,
  StageEnvironment,
  StageDuration,
  ProcessStageContent,
  ProcessStage,
  Process,
  ExtractProcessStagesInput,
  ExtractProcessStagesAIOutput,
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
  QuietHoursSchema,
  ProposeScheduleInputSchema,
  ProposedStageSchema,
  ComponentAdjustmentSchema,
  ProposeScheduleAIOutputSchema,
  ProposeScheduleOutputSchema,
} from './proposeSchedule.js';
export type {
  QuietHours,
  ProposeScheduleInput,
  ProposedStage,
  ComponentAdjustment,
  ProposeScheduleAIOutput,
  ProposeScheduleOutput,
} from './proposeSchedule.js';

// Process diff (issue #812, phase 2) — the render contract for reviewing a
// proposed restructure. NEVER persisted, so there is no back-compat surface, and
// there is deliberately no `split`: one stage becoming two is a removal plus two
// additions. `recipeDiff` is the precedent.
export {
  StageTextChangeSchema,
  StageNullableTextChangeSchema,
  StageKindChangeSchema,
  StageEnvironmentChangeSchema,
  StageDurationChangeSchema,
  ProcessStageDiffEntrySchema,
  ProcessStageChangeSchema,
  ProcessDiffSchema,
} from './processDiff.js';
export type {
  StageTextChange,
  StageNullableTextChange,
  StageKindChange,
  StageEnvironmentChange,
  StageDurationChange,
  ProcessStageDiffEntry,
  ProcessStageChange,
  ProcessDiff,
} from './processDiff.js';

// Batch (issue #812, phase 1) — ONE RUN at `batches/{batchId}`, family-shared with
// a random id. Everything on it is FROZEN at start: resolved grams AND their
// labels, the resolved totals, and the resolved schedule. Read batch.ts's header
// before adding a field — the reason the document repeats what the recipe and the
// formula already say is the whole point of it.
export {
  BatchStateSchema,
  BatchQuantitySchema,
  BatchUnitsSchema,
  BatchTotalsSchema,
  BatchStageSchema,
  BatchSchema,
  // The observation log (phase 4) — a SIBLING schema, because observations are a
  // subcollection under the run rather than a field on it: append-only over weeks,
  // and two people logging a weight on the same day must not clobber each other
  // under document-level LWW.
  BatchObservationImageSchema,
  BatchObservationSchema,
} from './batch.js';
export type {
  BatchState,
  BatchQuantityDoc,
  BatchUnitsDoc,
  BatchTotalsDoc,
  BatchStageDoc,
  BatchDoc,
  BatchObservationImage,
  BatchObservationDoc,
} from './batch.js';
