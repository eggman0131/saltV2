import { z } from 'zod';
import { MatchOrCreateCanonInputSchema } from './matchOrCreateCanonInput.js';
import { CanonicaliseRecipeIngredientsInputSchema } from './canonicaliseRecipeIngredientsInput.js';
import { AuthorRecipeInputSchema } from './authorRecipe.js';
import { ExtractRecipeFromUrlInputSchema } from './extractRecipeFromUrl.js';
import { IdentifyEquipmentInputSchema } from './identifyEquipment.js';
import { PopulateEquipmentEntryInputSchema } from './populateEquipmentEntry.js';

// ─── Browser→CF trace-continuity wire envelopes (issue #362, Phase 3) ──────────
//
// The Firebase JS callable SDK (firebase ^12, @firebase/functions) cannot carry
// a custom per-call HTTP header: HttpsCallableOptions is only
// { timeout?, limitedUseAppCheckTokens? }, and the transport sets its own fixed
// headers (Content-Type, Authorization, App Check, Instance-ID) with no hook to
// inject `traceparent`. So a browser-supplied W3C trace id rides as a NAMED,
// TYPED, OPTIONAL field on the callable WIRE input instead — NOT the forbidden
// magic `_trace` payload (which was named/untyped plumbing): this is a single
// schema-validated string the entrypoint strips before invoking the flow.
//
// `traceparent` is the W3C Trace Context header value
// (`00-<32 hex trace id>-<16 hex span id>-<flags>`). It is OPTIONAL and ADDITIVE,
// so old clients that omit it remain backward-compatible on read.
//
// CRITICAL — DOMAIN PURITY: these envelopes are TRANSPORT schemas only. The
// domain flow functions keep taking the PURE domain input (no `traceparent` in
// their logic). The CF entrypoint validates the wire envelope, pulls
// `traceparent` to install the trace context, and passes the clean domain input
// (the base schema's fields, with `traceparent` stripped) to the flow.
export const TraceparentSchema = z.string().optional();

export const MatchOrCreateCanonWireInputSchema = MatchOrCreateCanonInputSchema.extend({
  traceparent: TraceparentSchema,
});

export const CanonicaliseRecipeIngredientsWireInputSchema =
  CanonicaliseRecipeIngredientsInputSchema.extend({
    traceparent: TraceparentSchema,
  });

export const AuthorRecipeWireInputSchema = AuthorRecipeInputSchema.extend({
  traceparent: TraceparentSchema,
});

export const ExtractRecipeFromUrlWireInputSchema = ExtractRecipeFromUrlInputSchema.extend({
  traceparent: TraceparentSchema,
});

// The two equipment-add callables (issue #361). The multi-step add-equipment
// action fires identifyEquipment then populateEquipmentEntry with human
// think-time between; the browser mints ONE trace id and supplies the SAME
// `traceparent` to both, so both flows nest under one trace instead of two.
export const IdentifyEquipmentWireInputSchema = IdentifyEquipmentInputSchema.extend({
  traceparent: TraceparentSchema,
});

export const PopulateEquipmentEntryWireInputSchema = PopulateEquipmentEntryInputSchema.extend({
  traceparent: TraceparentSchema,
});

export type MatchOrCreateCanonWireInput = z.infer<typeof MatchOrCreateCanonWireInputSchema>;
export type CanonicaliseRecipeIngredientsWireInput = z.infer<
  typeof CanonicaliseRecipeIngredientsWireInputSchema
>;
export type AuthorRecipeWireInput = z.infer<typeof AuthorRecipeWireInputSchema>;
export type ExtractRecipeFromUrlWireInput = z.infer<typeof ExtractRecipeFromUrlWireInputSchema>;
export type IdentifyEquipmentWireInput = z.infer<typeof IdentifyEquipmentWireInputSchema>;
export type PopulateEquipmentEntryWireInput = z.infer<typeof PopulateEquipmentEntryWireInputSchema>;
