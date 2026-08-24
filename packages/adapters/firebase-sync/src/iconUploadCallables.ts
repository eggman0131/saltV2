import { getFunctions, httpsCallable } from 'firebase/functions';
import { ErrorCode, failure, type DomainError, type ReadResult } from '@salt/shared-types';
import type { IconUploadFamily, SetIconUploadInput } from '@salt/domain/schemas';
import { classifyCallableError, type CallableErrorOverrides } from './callableErrors.js';
import { FUNCTIONS_REGION } from './functionsRegion.js';

// Browser → the setIconUpload callable (issue #892). CLAUDE.md rule #2: the
// Firebase SDK is touched only here, and rule #3's Storage posture is why this is
// a callable at all — `storage.rules` grants no client write on any prefix, so the
// bytes go to a function and the Admin SDK writes the object.

// The payload cap is the schema's, so an `invalid-argument` rejection is a
// client-side programming error rather than a network one — surfaced as
// ValidationError so the reporting policy suppresses it and the UI can word it
// plainly. Everything else is the shared contract.
const OVERRIDES = {
  'invalid-argument': {
    kind: 'ValidationError',
    code: ErrorCode.ICON_UPLOAD_REJECTED,
    message: 'That image could not be used.',
  },
} as const satisfies CallableErrorOverrides;

const NOT_FOUND_RESOURCE: Record<
  IconUploadFamily,
  Extract<DomainError, { kind: 'NotFound' }>['resource']
> = {
  canon: 'canon',
  productForm: 'productForm',
  kitchenTool: 'kitchenTool',
  equipment: 'equipment',
};

/**
 * Uploads one cropped photograph as a family's pictogram. The server frames it to
 * the shared 108px content box, writes the family's Storage prefix and stamps the
 * cache-bust nonce; nothing is returned but success or a `DomainError`.
 */
export async function callSetIconUpload(
  family: IconUploadFamily,
  id: string,
  imageBase64: string,
  contentType?: SetIconUploadInput['contentType'],
): Promise<ReadResult<void, DomainError>> {
  try {
    const fn = httpsCallable<SetIconUploadInput, { ok: true }>(
      getFunctions(undefined, FUNCTIONS_REGION),
      'setIconUpload',
    );
    await fn({ family, id, imageBase64, ...(contentType ? { contentType } : {}) });
    return { kind: 'ok', value: undefined };
  } catch (err) {
    // The item was deleted under a page that was already open — expected, and
    // suppressed by the reporting policy rather than logged as a defect.
    if ((err as { code?: string }).code === 'functions/not-found') {
      return failure({ kind: 'NotFound', resource: NOT_FOUND_RESOURCE[family], id });
    }
    return failure(classifyCallableError(err, OVERRIDES));
  }
}
