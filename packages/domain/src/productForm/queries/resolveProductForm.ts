import { normaliseName, type CanonItem } from '../../canon/index.js';
import type { ProductForm } from '../entities/ProductForm.js';

/** Just enough of a canon item to ask whether some text names it. */
export type CanonNaming = Pick<CanonItem, 'id' | 'name'>;

// Pure table lookup: find the product form that `name` identifies.
//
// A form is identified by EVERYTHING it is called — its `label` as well as its
// `matchers`, competing on equal terms. `label` keeps every display use it has;
// it simply gains a second job as matching input. Six of the ten live forms had
// copied the label into `matchers` by hand, and every form that skipped the copy
// was a silent miss ("Chicken Legs", "Lemon zest") — so the label was already
// treated as matching input by the people authoring forms (issue #818).
//
// Both sides are folded with canon's `normaliseName` rather than a local
// lowercase/trim. Product-form resolution asks EXACTLY canon's question — does
// this ingredient text name this thing — so the two halves of one pipeline must
// not disagree about plurals, punctuation or quantity tokens. They did: an
// ingredient reading "chicken breast" could not find the form whose only matcher
// was "chicken breasts", and fell through to minting an orphan canon item.
// (Contrast `cookSession/normaliseContainerName`, which deliberately refuses this
// same helper — a container name is a label a cook reads off a bowl, and folding
// plurals would merge bowls a human can tell apart. Different question, so it
// keeps its own normaliser. This one is the same question, so it shares.)
//
// Containment is token-aligned: a phrase must occupy whole words of the
// ingredient, so a form matched on "oat" matches "rolled oats" and not "goat
// cheese". Longest phrase wins, measured on the NORMALISED phrase so the
// ordering stays deterministic.
//
// CONTESTED PHRASES LOSE (issue #1180). Promoting the label to matching input
// left one thing unasked: whether the phrase that wins actually distinguishes
// the parent it binds to. A matcher is authored by someone who knows the parent
// ("lime zest"); a bare component word ("Zest", "Juice", "Stock") names no
// parent at all, so — with `forms` always the whole collection, never a
// per-parent slice — it matched every parent's version of the same thing. A
// `Zest` form filed under Lemon claimed "zest of 1 lime", and the shopping list
// said buy lemons.
//
// So a candidate phrase is REJECTED when the ingredient text also names a
// DIFFERENT canon item, on at least one token the phrase does not itself cover,
// WITHIN THE SAME CLAUSE. Rejection is per-phrase, not per-form: a shorter
// uncontested phrase still wins, and when nothing survives the ingredient falls
// through to ordinary canon matching, which mints the right form on the right
// parent.
//
// Two clauses narrow "also names", and both are load-bearing.
//
// (1) TOKENS THE PHRASE DOES NOT COVER. "100 ml active whey" still binds its
// `Active whey` form even though a canon item is literally named `Whey`, because
// `whey` sits inside the winning phrase; "cheddar cheese slices" still binds
// despite a canon `Cheese`, for the same reason. Only a canon item named on the
// LEFTOVER words — the `lime` in "lime zest" — is evidence of a second product.
//
// (2) THE SAME CLAUSE. An ingredient line is often a list, and a second product
// named in a DIFFERENT item of that list is not competing for the same words —
// it is simply the next ingredient. Without this, "200 ml beef stock or water"
// lost its `Beef Stock` form to canon `Water`, "3 garlic cloves, finely chopped
// with salt" lost `garlic clove` to canon `Salt`, and the recipe card grew a
// false `missing_form` pip (issue #855's symptom, which is what #1180 is fixing
// the neighbourhood of). So the token stream is cut at the joiner words that end
// one product and start another, and a rival is weighed only where it shares a
// clause with the phrase it is contesting. Note this is NOT adjacency: "zest of
// 1 unwaxed lime" carries its rival three tokens away and still contests, which
// is exactly the reported defect.
//
// THE BOUNDARY, stated rather than rounded up to an absolute. This makes a
// phrase unable to bind a parent it does not distinguish FROM ANOTHER CANON
// ITEM THE TEXT NAMES IN THE SAME CLAUSE. It is not a general guarantee that a
// form never crosses parents, and three limits are real:
//
//   - a text naming no canon item but the form's own parent is uncontested by
//     construction, so "orange juice" still reaches a `Lime juice` form whose
//     matcher is the bare word "juice" for as long as no canon item is called
//     Orange;
//   - clauses are cut on JOINER WORDS alone (below). `normaliseName` deletes
//     punctuation before this function ever sees a token, so a compound line
//     joined only by a comma — "2 tbsp lemon juice, olive oil" — is one clause,
//     and can still lose its form to the rival it lists;
//   - an EMPTY canon list disables the rule entirely, which is exactly what a
//     failed canon read degrades to (Rule 10) and what every unit test that
//     passes `[]` relies on.
//
// All three are pinned by tests in
// `packages/domain/tests/productForm/resolveProductForm.test.ts`. A fourth limit
// needs no test because the signature already states it: "the text names a canon
// item" means `item.name` and nothing else — `CanonNaming` has no synonym field
// for one to arrive in, unlike `findExactCanonMatch`, which answers the
// same-sounding question with synonyms folded in.
//
// Match-time only: nothing here is written back. Stored labels and matchers stay
// exactly as they were typed.
export function resolveProductForm(
  name: string,
  forms: readonly ProductForm[],
  // REQUIRED, and deliberately not defaulted to `[]` (issue #1180). An optional
  // canon list would leave every call site that was never updated silently on
  // the old cross-parent behaviour — the defect again, invisibly. Required means
  // the compiler enumerates the call sites. A caller that genuinely has no canon
  // list in hand passes `[]` at its own site, where the degrade is legible.
  canon: readonly CanonNaming[],
): ProductForm | null {
  const target = normaliseName(name);
  if (!target) return null;
  const tokens = target.split(' ');
  // Where the line stops talking about one product and starts on the next.
  const joiners: number[] = [];
  for (const [i, token] of tokens.entries()) {
    if (JOINERS.has(token)) joiners.push(i);
  }

  // Built at most once per call, and only once some phrase has actually matched:
  // normalising the whole canon list is the expensive half of this function, and
  // the overwhelming majority of ingredient texts match no phrase at all.
  let named: readonly CanonSpan[] | null = null;
  const canonNamedInText = (): readonly CanonSpan[] => {
    if (named === null) {
      const spans: CanonSpan[] = [];
      for (const item of canon) {
        const phrase = normaliseName(item.name);
        if (!phrase) continue;
        for (const span of tokenSpans(tokens, phrase.split(' '))) {
          spans.push({ id: item.id, start: span[0], end: span[1] });
        }
      }
      named = spans;
    }
    return named;
  };

  let best: ProductForm | null = null;
  let bestLen = 0;
  for (const form of forms) {
    for (const phrase of [form.label, ...form.matchers]) {
      const p = normaliseName(phrase);
      // `>` not `>=`, as before: among equally long phrases the first one found
      // wins, so the answer stays deterministic for a given `forms` order.
      if (!p || p.length <= bestLen) continue;
      const occurrences = tokenSpans(tokens, p.split(' '));
      if (occurrences.length === 0) continue;
      const covered = new Set<number>();
      for (const [start, end] of occurrences) {
        for (let i = start; i < end; i++) covered.add(i);
      }
      // A contested phrase does not update `bestLen`, so it neither wins nor
      // blocks a shorter phrase that is uncontested.
      if (isContested(canonNamedInText(), covered, joiners, form.parentCanonId)) continue;
      best = form;
      bestLen = p.length;
    }
  }
  return best;
}

/** Where one canon item's name sits in the ingredient's token list. */
type CanonSpan = { id: string; start: number; end: number };

// Does the text name a canon item OTHER than this form's parent, using at least
// one word the winning phrase left over, IN A CLAUSE the phrase itself occupies?
// The parent itself never contests — "lemon zest" naming Lemon is the form
// agreeing with its own parent, not a rival claim. Nor does a rival standing in
// some other item of a list: the `Water` in "beef stock or water" is the next
// ingredient, not a competing reading of "beef stock".
function isContested(
  named: readonly CanonSpan[],
  covered: ReadonlySet<number>,
  joiners: readonly number[],
  parentCanonId: string,
): boolean {
  return named.some((span) => {
    if (span.id === parentCanonId) return false;
    for (let i = span.start; i < span.end; i++) {
      if (!covered.has(i) && sharesClause(i, covered, joiners)) return true;
    }
    return false;
  });
}

// The words that end one product and start another. Deliberately four, and only
// the ones an ingredient line actually uses to introduce a second product: "stock
// or water", "yolk and sugar", "chopped with salt", "oil plus extra". Every other
// word — "of", "from", "fresh", a whole preparation clause — keeps the rival in
// play, which is why "zest of 1 unwaxed lime" is still contested by Lime three
// tokens away. Widening this set widens what may bind across parents, so the
// narrow end is the safe one.
//
// `normaliseName` has already deleted every comma, bracket and semicolon by the
// time this function sees a token, so joiner WORDS are the only cut available —
// see THE BOUNDARY above.
//
// Folded through `normaliseName` rather than written out, because the tokens
// these are compared against have been: "plus" singularises to "plu", and a
// hand-written literal would have silently matched nothing.
const JOINERS: ReadonlySet<string> = new Set(
  ['and', 'or', 'with', 'plus'].map((word) => normaliseName(word)),
);

// Is the word at `i` still talking about the same product as the phrase — that
// is, does the phrase cover a word with no joiner standing between the two? A
// joiner the phrase itself spans ("salt and pepper" as one matcher) never
// separates it from its own words, because nothing stands strictly between them.
function sharesClause(
  i: number,
  covered: ReadonlySet<number>,
  joiners: readonly number[],
): boolean {
  for (const c of covered) {
    const lo = Math.min(i, c);
    const hi = Math.max(i, c);
    if (!joiners.some((j) => j > lo && j < hi)) return true;
  }
  return false;
}

// Every whole-token position at which `phrase` occurs in `tokens`. The token-array
// form of the padded-`includes` test this function used before: same alignment
// rule ("oat" matches "rolled oats", not "goat cheese"), but it also reports WHERE
// the hit is, which is what the contested-phrase rule needs.
//
// `phrase` is always at least one token: both call sites split a `normaliseName`
// result they have already tested for emptiness. No guard for the empty case,
// because an unreachable one is a branch no test can honestly cover.
function tokenSpans(
  tokens: readonly string[],
  phrase: readonly string[],
): readonly [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    let hit = true;
    for (let j = 0; j < phrase.length; j++) {
      if (tokens[i + j] !== phrase[j]) {
        hit = false;
        break;
      }
    }
    if (hit) out.push([i, i + phrase.length]);
  }
  return out;
}
