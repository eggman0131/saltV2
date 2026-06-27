import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { matchOrCreate, parseShoppingListEntry } from '@salt/domain';
import {
  flushServerObservability,
  startSpan,
  whenServerObservabilityReady,
} from '@salt/observability/server';
import { buildMatchOrCreatePorts } from '../flows/matchOrCreateCanon.js';
import { createServerEntryParseAdapter } from '../adapters/serverEntryParse.js';
import { reportServerError } from '../observability/reportServerError.js';

const TRIGGER_PATH = 'shoppingLists/{listId}/items/{itemId}';

// The trigger reaches Gemini (parse/embed/arbitrate) via matchOrCreate and
// emits PostHog server telemetry, so both secrets must be bound to its runtime —
// otherwise production has no GEMINI_API_KEY and every match fails. The emulator
// masked this by sourcing the keys from process.env (.secret.local). Defined
// here (not imported from index.ts) to avoid a circular import; the Firebase
// CLI aggregates same-named defineSecret calls across files at deploy time.
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

function looksCompound(text: string): boolean {
  return text.trim().split(/\s+/).length >= 3;
}

export const onShoppingListItemWrite = onDocumentWritten(
  {
    document: TRIGGER_PATH,
    region: 'europe-west2',
    secrets: [geminiApiKey, posthogApiKey],
    // The match pipeline makes up to three sequential AI calls — entry parse
    // (compound items only), embedding, then arbitration — each bounded at ~40s
    // by withAiTimeout (20s + 1 retry), so ~120s worst case. The default 60s
    // function timeout SIGKILLs the invocation mid-flight before the matchState
    // write-back runs, stranding the item at 'pending' forever: triggers don't
    // auto-retry and the item gets no further write to re-fire on. 180s leaves
    // headroom over the bounded AI budget so a terminal state is always written.
    // 512MiB mirrors canonicaliseRecipeIngredients — the same list() over the
    // whole canon collection + embeddings OOM-kills the default 256MiB instance,
    // another mid-flight death that leaves the item stuck 'pending'.
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async (event) => {
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

    // Parse: deterministic first; AI fallback for compound entries the rule missed.
    let parsed = parseShoppingListEntry(rawText);
    if (parsed.context === '' && parsed.amount === undefined && looksCompound(rawText)) {
      const aiResult = await createServerEntryParseAdapter().parse(rawText);
      if (aiResult.kind === 'ok') {
        parsed = aiResult.value;
      }
    }

    const cleanName = parsed.name;
    const context = parsed.context;
    const parsedAmount = parsed.amount;
    const parsedUnit = parsed.unit;
    const currentNotes = typeof afterData['notes'] === 'string' ? afterData['notes'] : '';

    const { listId, itemId } = event.params;
    const db = getFirestore();
    const docRef = db.collection('shoppingLists').doc(listId).collection('items').doc(itemId);

    await whenServerObservabilityReady();
    const span = startSpan(`shoppingList.matchItem: ${rawText}`);
    span.setAttribute('entrySource', 'shoppingListItem');
    span.setAttribute('listId', listId);
    span.setAttribute('itemId', itemId);

    let errorCategory: string | null = null;
    try {
      const result = await matchOrCreate(
        { rawName: cleanName, ...(rawText ? { rawText } : {}) },
        buildMatchOrCreatePorts(span),
      );

      if (result.kind === 'err') {
        errorCategory = result.error.kind;
        await docRef.update({
          matchState: 'failed',
          updatedAt: new Date().toISOString(),
          ...(parsedAmount !== undefined ? { amount: parsedAmount } : undefined),
          ...(parsedUnit !== undefined ? { unit: parsedUnit } : undefined),
        });
        return;
      }

      const { item, decision } = result.value;
      const newMatchState = item.needs_approval ? 'needs_approval' : 'matched';

      span.setAttribute('canon.outcome', decision);
      span.setAttribute('canon.result', item.id);

      const nameChanged = cleanName !== rawText;

      await docRef.update({
        canonId: item.id,
        matchState: newMatchState,
        updatedAt: new Date().toISOString(),
        ...(nameChanged && currentNotes === '' && { rawText: cleanName, notes: context }),
        ...(parsedAmount !== undefined ? { amount: parsedAmount } : undefined),
        ...(parsedUnit !== undefined ? { unit: parsedUnit } : undefined),
      });
    } catch (err) {
      // matchOrCreate and the AI adapters convert operational failures into a
      // Result (handled as 'failed' above), so reaching here means an unexpected
      // throw — a Firestore write blip, an OOM survivor, or a bug. Write a
      // terminal 'failed' so the item never sits in limbo: the user sees it
      // uncategorised under OTHER (checkable, re-addable) instead of a spinner
      // that never resolves. A hard timeout/OOM SIGKILL can't run this catch —
      // that path is prevented by the timeoutSeconds/memory headroom above.
      errorCategory = 'exception';
      logger.error('onShoppingListItemWrite: unexpected error', { err, docId: itemId });
      // Additive to the logger: surface this unexpected throw to PostHog error
      // tracking. Uncategorised → reported. Best-effort (never throws). The
      // finally block flushes before the function returns.
      reportServerError(err);
      await docRef
        .update({ matchState: 'failed', updatedAt: new Date().toISOString() })
        .catch((writeErr) => {
          logger.error('onShoppingListItemWrite: failed to write terminal state', {
            writeErr,
            docId: itemId,
          });
          // A failed terminal-state write is a StorageError-class failure that
          // leaves the item stuck; report it additively too.
          reportServerError(writeErr);
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
  },
);
