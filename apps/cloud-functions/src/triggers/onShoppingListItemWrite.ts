import { onDocumentWritten } from 'firebase-functions/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { matchOrCreate } from '@salt/domain';
import {
  flushServerObservability,
  startSpan,
  whenServerObservabilityReady,
} from '@salt/ld-observability/server';
import { buildMatchOrCreatePorts } from '../flows/matchOrCreateCanon.js';

const TRIGGER_PATH = 'shoppingLists/{listId}/items/{itemId}';

export const onShoppingListItemWrite = onDocumentWritten(TRIGGER_PATH, async (event) => {
  const after = event.data?.after;
  const before = event.data?.before;

  // Delete event — nothing to match.
  if (!after?.exists) return;

  const afterData = after.data() as Record<string, unknown>;
  const rawText = typeof afterData['rawText'] === 'string' ? afterData['rawText'] : '';
  const canonId = typeof afterData['canonId'] === 'string' ? afterData['canonId'] : null;
  const matchState = typeof afterData['matchState'] === 'string' ? afterData['matchState'] : '';

  // CF own write: the trigger wrote back canonId/matchState. matchState is
  // not 'pending' (matched/needs_approval/failed) or canonId is already set.
  // Skip to avoid an infinite loop.
  if (matchState !== 'pending' || canonId !== null) return;

  // Notes-only edit or check toggle: rawText is unchanged and the item
  // already existed. Only rawText changes (and new items) need re-matching.
  if (before?.exists) {
    const beforeData = before.data() as Record<string, unknown>;
    const beforeRawText = typeof beforeData['rawText'] === 'string' ? beforeData['rawText'] : '';
    if (beforeRawText === rawText) return;
  }

  const { listId, itemId } = event.params;

  await whenServerObservabilityReady();
  const span = startSpan(`shoppingList.matchItem: ${rawText}`);
  span.setAttribute('entrySource', 'shoppingListItem');
  span.setAttribute('listId', listId);
  span.setAttribute('itemId', itemId);

  let errorCategory: string | null = null;
  try {
    const result = await matchOrCreate({ rawName: rawText }, buildMatchOrCreatePorts(span));

    const db = getFirestore();
    const docRef = db.collection('shoppingLists').doc(listId).collection('items').doc(itemId);

    if (result.kind === 'err') {
      errorCategory = result.error.kind;
      await docRef.update({ matchState: 'failed', updatedAt: new Date().toISOString() });
      return;
    }

    const { item, decision } = result.value;
    const newMatchState = item.needs_approval ? 'needs_approval' : 'matched';

    span.setAttribute('canon.outcome', decision);
    span.setAttribute('canon.result', item.id);

    await docRef.update({
      canonId: item.id,
      matchState: newMatchState,
      updatedAt: new Date().toISOString(),
    });
  } finally {
    // DORMANT: trace propagation — trigger boundary; mark per convention.
    // When re-enabled, extract trace context from a header injected at write
    // time and call runWithExtractedTraceContext before the span is opened.
    logger.info('onShoppingListItemWrite', {
      scope: 'shoppingListItem',
      docId: itemId,
      errorCategory,
    });
    span.end();
    await flushServerObservability();
  }
});
