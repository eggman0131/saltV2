import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import {
  GetImagePromptResultSchema,
  type GetImagePromptInput,
  type GetImagePromptResult,
  type ImagePromptFamily,
} from '@salt/domain/schemas';
import { classifyCallableError } from './callableErrors.js';
import { invokeCallable } from './callFunction.js';

// Browser → the getImagePrompt callable (issue #892). CLAUDE.md rule #2: the
// Firebase SDK is touched only here; the web services consume this wrapper, never
// `firebase/functions` directly.
//
// The result is `.safeParse`d rather than trusted: a callable response arrives as
// `unknown` over the wire, which is a type-laundering boundary by the Zod
// conventions. A shape mismatch is a corruption, not a network blip, so it maps to
// StorageError — reported, exactly as the shared callable mapper now reports a
// server fault (issue #916).

/**
 * Which DomainError resource each family reports itself as when its document has
 * gone. Every value is a name the rest of the app already uses for that thing.
 */
const NOT_FOUND_RESOURCE: Record<
  ImagePromptFamily,
  Extract<DomainError, { kind: 'NotFound' }>['resource']
> = {
  canon: 'canon',
  productForm: 'productForm',
  kitchenTool: 'kitchenTool',
  equipment: 'equipment',
  recipe: 'recipe',
};

/**
 * Fetches the complete prompt behind one generated picture, with the model it
 * resolves to and the style seed it is conditioned on. Read-only: nothing is
 * written, nothing is generated, and no AI call is made server-side.
 */
export async function callGetImagePrompt(
  family: ImagePromptFamily,
  id: string,
): Promise<ReadResult<GetImagePromptResult, DomainError>> {
  // `invokeCallable` rather than `callFunction`, for two reasons that both need
  // the raw material: the wire result is `.safeParse`d before it is trusted (see
  // the header), and the `not-found` arm below reads the rejection's code ahead
  // of the shared mapper.
  try {
    const data = await invokeCallable<GetImagePromptInput, unknown>({
      name: 'getImagePrompt',
      input: { family, id },
    });
    const parsed = GetImagePromptResultSchema.safeParse(data);
    if (!parsed.success) {
      return failure({ kind: 'StorageError', reason: 'corruption' });
    }
    return success(parsed.data);
  } catch (err) {
    // A missing document is an expected race — the item was deleted under a page
    // that was already open — so it comes back as NotFound and is suppressed by
    // the reporting policy rather than logged as a defect.
    if ((err as { code?: string }).code === 'functions/not-found') {
      return failure({ kind: 'NotFound', resource: NOT_FOUND_RESOURCE[family], id });
    }
    return failure(classifyCallableError(err));
  }
}
