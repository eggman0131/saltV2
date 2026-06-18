# AI Kitchen Assistant

The conversational AI feature: the **main point of the app**. It is one chat engine
serving two purposes — a general kitchen assistant (open Q&A, recipe ideation) and a
structured recipe author. This is the follow-on epic deferred from the recipe
foundation (#179).

## Design principles (load-bearing — do not violate)

1. **The chef speaks in plain text.** Conversational turns have **no structured
   output schema and no tools**. Structure is the librarian's job, applied only at
   save time. Forcing structure or tool-use onto the chat is exactly what made the
   earlier prototype feel constrained and produce sub-Gemini answers. Keep the chat
   free.
2. **Equipment is ambient context, never a tool.** The user's kit is small enough to
   drop straight into the chef's system prompt ("here's the equipment available —
   draw on it when it genuinely helps, ignore it otherwise"). No retrieval tool,
   nothing the model feels obliged to call. The assistant must never be *bound* to
   the user's equipment.
3. **Pro-tier model for the chef.** Conversation quality is the whole point — use a
   Pro-tier Gemini for the chef, not Flash. The librarian (structured extraction)
   stays on Flash + `temperature: 0`, consistent with the other parse flows.
4. **One agent, not three.** The user's "creative chef / kitchen engineer /
   librarian" roles survive as *intentions*, not as a forced pipeline. The
   "engineer" is just the user asking ("how do I make the most of my kit here?") —
   the equipment context is already present, so the same agent answers. Only the
   librarian is a genuinely separate (non-conversational) component.

## Scope boundaries

- "Contents of my kitchen" means **equipment + accessories only**. There is no
  pantry/fridge inventory module and this feature does not add one.
- A saved recipe **must canon-match** its ingredients (reuse the existing canon
  pipeline). Adding to the shopping list or meal planner stays a **manual** action
  (shopping-list add already exists).

## Per-user data — a deliberate first

Chats are the **first per-user-scoped data in Salt**. Everything else is
family-shared with no `userId` anywhere; this is an intentional, recorded departure.

- Chat documents carry `ownerUid` (= `request.auth.uid`).
- New `firestore.rules` pattern: a caller may read/write a chat **only if they own
  it** (`resource.data.ownerUid == request.auth.uid`, and on create
  `request.resource.data.ownerUid == request.auth.uid`). This is the first
  owner-scoped rule block; all prior blocks are "any authenticated member".
- Retention ~2 weeks via an `expiresAt` timestamp + a **Firestore TTL policy**
  (configured once per project via console/gcloud — infra, not rules). Each write
  bumps `expiresAt` to now + 14 days.
- **TTL setup (one-off, both projects):** In the Firebase console (or via
  `gcloud firestore fields ttls update`), enable the TTL policy on the
  `chatSessions` collection for the `expiresAt` field. This must be applied to
  both the staging and production Firestore projects. The policy is infra, not
  code — it does not live in `firestore.rules` or any deployed artefact.

## Components

```
chat session doc (Firestore)         ← owned by web-pwa + firebase-sync (client writes)
  └─ chef flow (CF, Genkit, streaming, plain text)   ← reads equipmentManifest, returns reply
  └─ librarian flow (CF, Genkit, structured)         ← conversation → RecipeDoc draft
        └─ reuses canonicaliseRecipeIngredients       ← canon-matches ingredients
```

### 1. Chat session (data + persistence)

- Schema in `@salt/domain/schemas/chatSession.ts`, exported via the schemas index.
- One doc per session at `chatSessions/{id}`:
  `{ id, ownerUid, recipeId: string | null, title, messages: Message[],
     createdAt, updatedAt, expiresAt }`.
  `Message = { id, role: 'user' | 'assistant', text, createdAt }`.
- `recipeId` set ⇒ the session is **attached to a recipe** (the "open chat alongside
  a recipe" mode). `null` ⇒ general kitchen-assistant chat.
- Messages are an **array in the session doc** (not a subcollection): simpler store,
  TTL, and optimistic updates. A cooking chat will not approach the 1 MB doc ceiling;
  note the bound. Per-token streaming is **not** persisted — the client holds the
  partial assistant text in memory and writes the final message once on completion.
- `firebase-sync` store (`chatSessionSubscription.ts` + writes) follows the
  `recipeSubscription.ts` pattern exactly: `onSnapshot` + `safeParse` (skip+log
  invalid on list, `Failure` on single-doc corruption), `ReadResult` envelopes.
  Apply the **optimistic snapshot guard** (drop `onSnapshot` echoes older than the
  newest local edit by `updatedAt`) — see existing optimistic stores.

### 2. Chef flow (the conversation)

- Genkit flow in `apps/cloud-functions/src/flows/chefChat.ts`, exposed via
  `onCallGenkit` (gives streaming + `authPolicy: isSignedIn()` for free), region
  `europe-west2`, `secrets: [geminiApiKey]`, App Check monitor-first
  (`enforceAppCheck: false`, flip later with the rest).
- **Streaming**: define the flow with a stream schema and emit chunks; the client
  consumes via `httpsCallable(...).stream()`. This is the one piece of newer
  plumbing — **validate it early and interactively** (WSL2 emulator quirks).
- Input: `{ messages: Message[], newMessage: string }` (recent history window +
  the new turn). The flow is **stateless** — it does not write chat docs.
- The flow reads the **equipment manifest** doc server-side (admin SDK, like the
  canon flows read the canon collection) and injects it into the system prompt as
  ambient context. Client stays simple; equipment is always fresh.
- Plain text out. **No `output` schema. No tools.** Wrap the generate call in
  `withAiTimeout`.

### 3. Librarian flow (conversation → recipe)

- Genkit flow `apps/cloud-functions/src/flows/authorRecipe.ts`, structured output,
  Flash + `temperature: 0`. Exposed via `onCallGenkit` (or `onCall` if it needs the
  batch memory bump like `canonicaliseRecipeIngredients`).
- Input: the conversation (or the portion the user points at). Output: a
  `RecipeDoc`-shaped draft — title, description, metadata, ingredient groups
  (`rawText`, `isOptional`), steps (with ids), and **step↔ingredient links emitted
  directly** (the model names, per ingredient, the step it is first used in; the
  server resolves ordinals to `firstUsedInStepId`). Do **not** post-compute this.
- Canon: the draft's ingredients are run through the existing
  `canonicaliseRecipeIngredients` path to fill `canonId` / `matchState`. The client
  assembles the final `RecipeDoc` and persists with the existing `saveRecipe`.

## Surfaces (web-pwa)

- `/chat` — general kitchen-assistant chat (message list, streaming render).
- Recipe-attached chat — opened alongside an existing recipe; same chat engine with
  `recipeId` set; "apply changes" re-runs the librarian against the recipe.
- "Save as recipe" action on a general chat → librarian → new recipe.

## Constraints inherited from the architecture

- All Gemini access via Genkit flows + callables in cloud-functions; **no AI keys in
  the client**.
- No new package and **no layer-map change** — schemas in `@salt/domain`, flows in
  `cloud-functions`, adapter/store in `firebase-sync` + `web-pwa`, UI primitives via
  `@salt/ui-components`.
- Recipe schema now holds live production data (module shipped to all members
  in #240, 2026-06-17) — recipe schema changes need back-compat on read or a
  migration, like any other production collection. Chat schema is brand-new
  (no back-compat burden yet).
</content>
</invoke>
