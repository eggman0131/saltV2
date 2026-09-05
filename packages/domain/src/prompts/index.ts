// The `@salt/domain/prompts` subpath: model-facing prose that more than one
// package must state, and that CLAUDE.md rule 6 leaves with nowhere else to live
// (issue #934). See `stepPolicy.ts` for the full reasoning and the two-register
// pattern every constant here follows.
//
// It is a subpath rather than part of the main index for the same reason
// `./schemas` is one: nothing importing `@salt/domain` for its pure logic should
// have to carry prompt text it will never send.

export { ONE_OPERATION_PER_STEP_PRINCIPLE } from './stepPolicy.js';
export {
  READER_UNIT_PRINCIPLE,
  SPOON_MEASURE_CAP_TBSP,
  clampSpoonMeasureDisplayText,
} from './unitPolicy.js';
export { OPTIMISE_FOR_KITCHEN_PROMPT, REFRESH_PROMPT } from './recipeChatPrompts.js';
