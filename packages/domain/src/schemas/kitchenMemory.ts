import { z } from 'zod';

// `kitchenMemories/{id}` — one note the household wrote for the chef (issue #816).
//
// A COLLECTION, one document per note, deliberately NOT a singleton doc holding an
// array of entries. Salt resolves conflicts by whole-document last-write-wins with
// no merge logic at any layer (CLAUDE.md — LWW per document): a shared array would
// mean both members reading the same document, appending to their own copy and
// writing the whole thing back, so two notes added in the same moment silently
// leave one behind. One doc per note makes an add independent of every other add,
// makes a delete a `deleteDoc` rather than a read-modify-write, and needs neither a
// callable nor a transaction to be correct.
//
// FAMILY-SHARED, like everything except the per-user collections CLAUDE.md
// enumerates (it holds the authoritative count): no
// `ownerUid`, no per-user scoping. Either member may add, read and remove any note —
// it is a shared kitchen, and a note is about the household's cooking, not about
// the person who happened to type it.
//
// Greenfield collection → no back-compat constraint.

// Named here because TWO layers now address this collection: the browser adapter
// (`kitchenMemorySubscription`) and the Cloud Function that reads the notes into
// the chef's prompt via the Admin SDK. A string literal in each is a rename waiting
// to go half-done, so the name lives with the schema that describes the documents.
export const KITCHEN_MEMORY_COLLECTION = 'kitchenMemories';

export const KitchenMemorySchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1).default(1),
  // What to remember, in the household's own words. Stored verbatim: nothing
  // classifies, summarises or rewrites it — capture involves no AI at all.
  text: z.string(),
  // The writer's DISPLAY NAME, denormalised at write time, so a note reads
  // "Daniel · we hate coriander" without a second lookup.
  //
  // Deliberately NOT a uid. firestore.rules records the standing invariant that
  // uids appear nowhere in the family-shared data model — members are keyed by
  // email — and a uid would additionally be unreadable in the one place this field
  // exists to be read: on screen, next to the note.
  author: z.string(),
  createdAt: z.string(), // ISO
});

export type KitchenMemoryDoc = z.infer<typeof KitchenMemorySchema>;
