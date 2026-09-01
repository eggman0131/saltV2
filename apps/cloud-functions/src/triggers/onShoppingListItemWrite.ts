import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { matchOrCreate, parseShoppingListEntry } from '@salt/domain';
import { ShoppingListItemSchema } from '@salt/domain/schemas';
import { startSpan, type ObservabilitySpan } from '@salt/observability/server';
import { buildMatchOrCreatePorts } from '../flows/matchOrCreateCanon.js';
import { createServerEntryParseAdapter } from '../adapters/serverEntryParse.js';
import { reportServerError } from '../observability/reportServerError.js';
import { withFirestoreTrigger, traceContextFromWrittenDoc } from './triggerEntrypoint.js';

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
    // memory: the same list() over the whole canon collection + embeddings would
    // OOM-kill a 256MiB instance — another mid-flight death that strands the item
    // at 'pending'. Pinned inline at the 512MiB floor rather than inherited from
    // index.ts's setGlobalOptions: this trigger module is evaluated before that
    // call runs, so the global never reaches it (same reason region is inline).
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  withFirestoreTrigger<{ listId: string; itemId: string }>(async (event) => {
    const after = event.data?.after;
    const before = event.data?.before;

    // Delete event — nothing to match.
    if (!after?.exists) return;

    const { listId, itemId } = event.params;
    const afterData = after.data() as Record<string, unknown>;

    // The trigger's trust boundary. This used to be six hand-written `typeof`
    // narrowings; it is now the same `safeParse` every other trigger in this
    // directory reaches its document through — directly, or via the shared
    // `timerWriteTrigger` / `iconWriteTrigger` helpers. Per docs/data-model.md
    // ("Zod validation failures, per boundary") a Firestore trigger LOGS AND
    // RETURNS: there is no caller to hand a Failure to, and nothing here may
    // throw (Rule 10). Note what that changed and what it did not: the schema's
    // defaults reproduce the old fallbacks exactly for an ABSENT field
    // (`rawText`/`notes` → `''`, `canonId` → `null`), while a field that is
    // present and the wrong TYPE now stops the invocation instead of being
    // silently read as `''` and matched on.
    const parsed = ShoppingListItemSchema.safeParse(afterData);
    if (!parsed.success) {
      logger.error('onShoppingListItemWrite: invalid shoppingList item doc, skipping', {
        listId,
        itemId,
        error: parsed.error.message,
      });
      return;
    }
    const item = parsed.data;
    const rawText = item.rawText;
    const canonId = item.canonId;
    // Distributed-trace correlation (issue #362, Phase 5). The browser stamped its
    // action span's W3C traceparent here at "add to shopping list"; we continue
    // that trace below so the match span nests under the browser action instead of
    // re-rooting. Absent degrades to a root trace; a malformed (non-string) one
    // now fails the parse above rather than being dropped silently.
    const traceContext = item.traceContext;

    // CF own write: the trigger wrote back canonId/matchState. matchState is
    // not 'pending' (matched/needs_approval/failed) or canonId is already set.
    // Skip to avoid an infinite loop.
    //
    // Read off the RAW document, and it is the ONE field here that is. The schema
    // gives `matchState` a `.catch('pending')`, so a document missing the field —
    // or carrying a fifth state nobody has shipped yet — parses as 'pending', and
    // this guard would flip from SKIP to MATCH for exactly the documents it
    // understands least. This guard is the brake on the trigger's own write-back,
    // so it keeps reading what is actually stored. Pinned by the "no matchState
    // field at all" case in onShoppingListItemWrite.test.ts.
    const storedMatchState =
      typeof afterData['matchState'] === 'string' ? afterData['matchState'] : '';
    if (storedMatchState !== 'pending' || canonId !== null) return;

    // Notes-only edit or check toggle: rawText is unchanged and the item
    // already existed. Only rawText changes (and new items) need re-matching.
    if (before?.exists) {
      const beforeParsed = ShoppingListItemSchema.safeParse(before.data());
      // A `before` that does not parse cannot prove the text is unchanged. `''` is
      // what the old field-by-field read produced for it, and the only thing this
      // guard ever does is SKIP — so the worst case of getting it wrong is a
      // re-match, never a missed one.
      const beforeRawText = beforeParsed.success ? beforeParsed.data.rawText : '';
      if (beforeRawText === rawText) return;
    }

    const currentNotes = item.notes;

    const db = getFirestore();
    const docRef = db.collection('shoppingLists').doc(listId).collection('items').doc(itemId);

    let errorCategory: string | null = null;
    // Continue the browser-rooted trace carried by the doc's traceContext field
    // (issue #362, Phase 5). The span is opened INSIDE the supplied context so it
    // nests under the browser action span instead of re-rooting; the canon
    // write-back also stamps traceContext (via buildMatchOrCreatePorts) so the
    // onCanonItemWritten icon trigger continues the same trace. Env-gated:
    // suppressed under GENKIT_TELEMETRY_SERVER (local dev → Dev UI root-listing).
    // Absent/malformed traceContext degrades to a normal root trace, never throws.
    //
    // The span is opened inside the closure (to inherit the context) but ended in
    // the finally below; a holder object publishes it back out. A plain `let`
    // reassigned only inside the arrow narrows to `never` at the outer read under
    // strict control-flow analysis — an object property sidesteps that.
    const spanHolder: { current: ObservabilitySpan | null } = { current: null };
    try {
      // Parse INSIDE the installed trace context so the compound-entry AI
      // fallback's `parseEntry` flow joins this trace instead of re-rooting a
      // fresh one (issue #370 — it ran before the wrapper previously).
      // Deterministic first; AI fallback only for compound entries the rule missed.
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

      const matchSpan = startSpan(`shoppingList.matchItem: ${rawText}`);
      spanHolder.current = matchSpan; // hoist for the finally below (end + flush)
      matchSpan.setAttribute('entrySource', 'shoppingListItem');
      matchSpan.setAttribute('listId', listId);
      matchSpan.setAttribute('itemId', itemId);

      const result = await matchOrCreate(
        { rawName: cleanName, ...(rawText ? { rawText } : {}) },
        await buildMatchOrCreatePorts(matchSpan, traceContext),
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

      matchSpan.setAttribute('canon.outcome', decision);
      matchSpan.setAttribute('canon.result', item.id);

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
      logger.info('onShoppingListItemWrite', {
        scope: 'shoppingListItem',
        docId: itemId,
        errorCategory,
      });
      // null only if startSpan threw before assignment (it cannot — it returns a
      // no-op span when telemetry is off); guard for type-safety.
      spanHolder.current?.end();
    }
  }, traceContextFromWrittenDoc),
);
