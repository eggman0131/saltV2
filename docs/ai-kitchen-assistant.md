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
   nothing the model feels obliged to call. The assistant must never be _bound_ to
   the user's equipment.
3. **Pro-tier model for the chef.** Conversation quality is the whole point — use a
   Pro-tier Gemini for the chef, not Flash. The librarian (structured extraction)
   stays on Flash + `temperature: 0`, consistent with the other parse flows.
4. **One agent, not three.** The user's "creative chef / kitchen engineer /
   librarian" roles survive as _intentions_, not as a forced pipeline. The
   "engineer" is just the user asking ("how do I make the most of my kit here?") —
   the equipment context is already present, so the same agent answers. Only the
   librarian is a genuinely separate (non-conversational) component.
5. **Guided cook mode never shows less than plain cook mode** (#761). Guidance is
   added on top of what the recipe already says — it never replaces or withholds it,
   so every amount plain cook mode prints must be on the guided screen too.
   The one thing guided mode is allowed to _replace_ is the **faded peek at the next
   step** (#769), and only because that peek is not content: it is the top few lines
   of the next step, cut off at whatever height the layout leaves and unreadable by
   design. The plan's authored look-ahead says more in the same space, and says the
   one thing the raw text structurally cannot — which part of the next step has to be
   _started now_ (an oven that needs fifteen minutes, a steak that needs half an hour
   out of the fridge). Nothing is withheld: the step's own words arrive in full a
   moment later, unchanged, and a plan with no look-ahead falls back to the fade.

## Scope boundaries

- "Contents of my kitchen" means **equipment + accessories only**. There is no
  pantry/fridge inventory module and this feature does not add one. The household
  favourites the chef sees (issue #726) are **not** an inventory: they are a
  purchase _history_ — what got ticked off at the shop, over time — and say
  nothing about what is in the house right now. Do not let them grow into one.
- A saved recipe **must canon-match** its ingredients (reuse the existing canon
  pipeline). Adding to the shopping list or meal planner stays a **manual** action
  (shopping-list add already exists).
- **The librarians never read kitchen memory notes.** `authorRecipe`,
  `extractRecipeFromUrl`, `extractRecipeFromPhoto` and `generateGuidedPlan` are
  temperature-0 transcribers; handing one a preference like "we hate coriander"
  licenses it to quietly rewrite an imported recipe. A note shapes what the chef
  *suggests* in conversation — it must never touch what a recipe *says*. Only
  `chefChat` reads `kitchenMemories` (see Components, below).

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
  bumps `expiresAt` to now + 14 days — **except a recipe-attached chat** (`recipeId`
  set), which is stamped with a far-future `expiresAt` instead: issue #707 lists it
  permanently on the recipe's "Chef chats" card, so it must survive the TTL sweep
  rather than expire like a general kitchen-assistant chat.
- **TTL setup (one-off, both projects):** In the Firebase console (or via
  `gcloud firestore fields ttls update`), enable the TTL policy on the
  `chatSessions` collection for the `expiresAt` field. This must be applied to
  both the staging and production Firestore projects. The policy is infra, not
  code — it does not live in `firestore.rules` or any deployed artefact.

## Components

```
chat session doc (Firestore)         ← owned by web-pwa + firebase-sync (client writes)
  └─ chef flow (CF, Genkit, streaming, plain text)   ← reads equipmentManifest, returns reply
                                                         + kitchenMemories (issue #816)
  └─ librarian flow (CF, Genkit, structured)         ← conversation → RecipeDoc draft
        └─ reuses canonicaliseRecipeIngredients       ← canon-matches ingredients

kitchenMemories/{id} (Firestore, family-shared)      ← owned by web-pwa + firebase-sync
  └─ captured by `/remember <text>` — parsed, not classified (no AI, no flow)
  └─ read server-side into the chef's system prompt, grouped by author
```

### 1. Chat session (data + persistence)

- Schema in `@salt/domain/schemas/chatSession.ts`, exported via the schemas index.
- One doc per session at `chatSessions/{id}`:
  `{ id, ownerUid, recipeId: string | null, basedOnRecipeId: string | null, title,
     messages: Message[], createdAt, updatedAt, expiresAt }`.
  `Message = { id, role: 'user' | 'assistant', text, createdAt }`.
- `recipeId` set ⇒ the session is **attached to a recipe** (the "open chat alongside
  a recipe" mode). `null` ⇒ general kitchen-assistant chat.
- `basedOnRecipeId` (issue #763) is a **different question**: the dish this chat
  STARTED FROM, for a "Make a variation" conversation, as against the dish it
  BELONGS to. A variation has the second and not the first, so it does not appear
  on the base recipe's chat list and keeps the ordinary 14-day expiry until it
  produces something; on "Save as recipe" it claims the NEW recipe, ending up with
  both fields set and pointing at two different dishes. Both flows read the base
  server-side, so the transcript never carries pasted recipe text. It is
  `.nullable().default(null)` and that is load-bearing, not stylistic: the
  realtime subscription skips docs that fail validation, so a required field would
  have made every pre-existing chat vanish from the list rather than error.
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
  `europe-west2`, `secrets: [geminiApiKey]`, App Check from the shared
  `APP_CHECK_ENFORCEMENT` constant like every other callable (see
  [salt-architecture.md §8.1](salt-architecture.md)).
- **Streaming**: define the flow with a stream schema and emit chunks; the client
  consumes via `httpsCallable(...).stream()`. This is the one piece of newer
  plumbing — **validate it early and interactively** (WSL2 emulator quirks).
- Input: `{ messages: Message[], newMessage: string }` (recent history window +
  the new turn). The flow is **stateless** — it does not write chat docs.
- The flow reads the **equipment manifest** doc server-side (admin SDK, like the
  canon flows read the canon collection) and injects it into the system prompt as
  ambient context. Client stays simple; equipment is always fresh.
- It also reads **household favourites** the same way (issue #726): the
  `canonData/purchaseCounts` tick-off history, joined against `canonItems`, with
  `shoppingBehavior === 'stocked'` dropped so pantry staples cannot drown the
  taste signal. Ambient context like the equipment, and steered **in words** —
  "something a bit different" pushes away from the list, "our usual stuff" leans
  in. There is deliberately no mode flag, no wire field, and no chat UI for it.
  Absent or empty counts omit the section entirely, so the chef behaves exactly
  as it did before the feature existed.
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
- **The librarian only ever authors cookable kinds** (#637). A fresh draft is
  written as `kind: 'recipe'` — ingredients and a method are the entire output, so
  there is nothing for it to produce that is not one. On an _amend_ it carries the
  base recipe's own kind through unchanged, so re-running the librarian against an
  existing entry can never silently re-type it (`kind` is immutable by design).
  A "When you CBA" outing is hand-written and has nothing to author, and the
  Ask / amend affordance is capability-gated off its view page, so the librarian is
  simply unreachable for one.
- **Which kinds it may author is now a named predicate** — `isAuthorable` in
  `packages/domain/src/recipe/queries/capabilities.ts` (#763). Only `recipe` is
  `true`, and the `false` on `cocktail` means **not yet**: `assembleRecipeDraft`
  hardcodes `kind: baseRecipe?.kind ?? 'recipe'`, so no AI path can emit a cocktail
  and one authored by chat would be stuck in the dinner list forever. That is a bug
  in its own right, with no issue yet. When it is fixed, flipping that one row is
  the whole change — every consumer (the ⋮ entry point, the flows, the chip)
  inherits it untouched.
- **Three prompt closings, not two.** `CREATE_MODE_CLOSING` (the conversation is
  the only source of truth), `editModeSection` (return the COMPLETE updated recipe)
  and `variationModeSection` (#763 — build on the base, but give it a name of its
  own). Variation mode grounds the PROSE on the base recipe while still calling
  `assembleRecipeDraft` with `baseRecipe: null`, which is what makes a variation an
  independent dish: no `producesCanonId` carried, no image shared with the original
  (the doc-id-keyed orphan sweep makes a shared image a data-loss bug — see
  [recipe-module.md](recipe-module.md) § "Duplicating a recipe"), and a hero
  generated from the new content. Edit mode wins if both ids somehow arrive.

### 4. Kitchen memory (the household's own notes for the chef)

- Issue #816. `/remember <text>` in the chat composer, on any conversation,
  saves a standing note; `parseChatCommand` (`@salt/domain`) recognises the
  command by reading characters, case-insensitively — no classifier, no flow,
  no per-turn cost. The command branch runs ahead of the usage event, the
  stream and the title-generation call, so a `/remember` as the first line of
  a chat triggers no AI at all.
- Schema in `@salt/domain/schemas/kitchenMemory.ts`. `kitchenMemories/{id}` —
  **a collection, one document per note**, family-shared like everything
  except the three per-user collections (no `ownerUid`). A singleton doc with
  an entries array was rejected: whole-document LWW with no merge logic means
  two notes added in the same moment would silently lose one; one doc per
  note makes an add independent and a delete a plain `deleteDoc`. `author` is
  a display name denormalised at write time, never a uid.
  Greenfield collection, no back-compat burden.
- `firebase-sync`'s `kitchenMemorySubscription.ts` follows the **list read**
  contract (skip-and-log a corrupt note, deliver the rest), unlike
  `guidedPlanSubscription`'s single-doc refuse-on-corrupt — a note is one
  sentence, not a reviewed artefact.
- `/chat/remembered` ("What I remember", `ChatMemoryPage.svelte`) lists every
  note grouped by author, and can add or delete one. An ordinary shell route
  (not full-viewport) — reading and tidying notes is not a hands-full mode.
- **Phase 2 — the chef reads them.** `apps/cloud-functions/src/flows/kitchenMemoryContext.ts`
  reads `kitchenMemories` server-side (Admin SDK, like the equipment
  manifest) and renders them into `chefChat`'s system prompt, grouped by
  author. Framed as *preferences, not rules* — the conversation always wins,
  and the chef may raise a note only once, only when it belongs to someone
  **other** than the person it is talking to. Degrades to no section at all
  on an empty, missing or unreadable collection (Rule 10) and never lists the
  notes back or opens with them.
- The librarians never read this collection — see Scope boundaries, above.

## Surfaces (web-pwa)

- `/chat` — general kitchen-assistant chat (message list, streaming render).
- `/chat/remembered` — "What I remember" (issue #816), listed and static so it
  precedes the parameterised `/chat/:id` route; see Components §4 above.
- Recipe-attached chat — opened alongside an existing recipe; same chat engine with
  `recipeId` set; "apply changes" re-runs the librarian against the recipe.
- Authoring a NEW recipe out of a conversation — one leg, `src/lib/chatRecipeAuthor.ts`,
  three buttons (#798). It is always the CREATE path (`recipeId` never sent), it stamps
  the clock, saves, and fires one `recipe.created` with `recipe_method: 'chat'`; the
  page owns its busy state, its toasts, its navigation and whether the conversation
  goes on to claim what it produced. The three:
  - **"Save as recipe"** on a general chat (`chat-save-recipe-btn`) — passes the
    session's `basedOnRecipeId` through, so a variation chat is grounded on the dish
    it started from, and CLAIMS the session for the recipe it invented.
  - **"Save as new recipe"** on a chat attached to a recipe — in the full page's
    header (`chat-save-new-recipe-btn`) and in the recipe page's docked chat column
    and drawer (`sidebar-save-new-recipe-btn` / `drawer-save-new-recipe-btn`), both
    rendered from one `saveAsNewRecipeAction` snippet. Same gate as "Review changes":
    at least one assistant turn. It passes `basedOnRecipeId: null` **even on a session
    that has one**, and does NOT claim — an accompaniment is not derived from the dish
    it accompanies, and the conversation stays listed on the dish it is attached to,
    so the new recipe has no origin chat. The dish on screen is never written to.
  - The pair on an attached chat is the whole distinction: **Review changes** folds
    the conversation into THIS dish behind a diff; **Save as new recipe** makes it a
    different dish and leaves this one alone. Everything saved this way is
    `kind: 'recipe'` — see `isAuthorable` above; that is the pre-existing librarian
    limitation, not something the button introduces.
- Variation chat (#763) — ⋮ → **Make a variation** on a recipe opens a NEW chat at
  `/chat/:id` carrying `basedOnRecipeId`, with a *Based on: …* chip and an empty
  transcript. It navigates AWAY from the recipe deliberately: you are leaving that
  dish to make a different one. Nothing is written but the session doc until "Save
  as recipe", which is the same button a general chat already has — there is no
  new exit from the recipe-amend review gate, and Duplicate is untouched. Note the
  difference from "Save as new recipe" (#798): a variation is *this dish, but
  different* and carries `basedOnRecipeId`; an accompaniment is *a different dish*
  and carries nothing.
- My Kitchen (`/mine`) — a "Recent chats" footer linking straight back into the last
  few conversations. Read-only and free: it projects the app-wide subscription
  started at auth, so it is a shortcut into chat, not a second place chat lives.
  Chef is the fourth primary nav tab again as of #828, which returned it the slot
  it lent the personal view in #634 — but that is the nav's doing, not this link's.

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
