import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import { updateListItem } from './updateListItem.js';

export interface EditItemRawTextInput {
  readonly id: string;
  readonly rawText: string;
  readonly now: string;
}

export function editItemRawText(
  items: readonly ShoppingListItem[],
  input: EditItemRawTextInput,
): ReadResult<ShoppingListItem[], DomainError> {
  return updateListItem(items, input.id, input.now, (item) => {
    const rawText = input.rawText.trim();
    if (!rawText) {
      return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_ITEM_RAW_TEXT });
    }
    // A match is a function of `rawText` and global canon, so only a genuine text
    // change invalidates it (issue #699). This command is composed into every
    // edit-sheet move — the sheet always submits its text field, edited or not —
    // so an unconditional reset would make a single-item move re-match while the
    // bulk move preserved it, exactly the divergence #694 rejected. Stating the
    // rule here rather than at the call site also makes the command idempotent
    // and leaves the page's `rawChanged` guard a redundancy rather than the only
    // thing preventing a spurious re-match.
    return success(
      rawText === item.rawText
        ? { ...item, rawText }
        : { ...item, rawText, canonId: null, matchState: 'pending' },
    );
  });
}
