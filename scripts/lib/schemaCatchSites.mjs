/**
 * Where a Zod `.catch()` sits, and what it is attached to (issue #1251).
 *
 * The decision layer behind `scripts/tests/schemaCatchGuard.test.mjs`, which is
 * issue #1114's recurrence guard: a `.catch()` on a schema that parses a stored
 * Firestore document switches off the skip-and-log contract for that field, and
 * the guard exists so a new one has to be argued for rather than merely typed.
 *
 * The guard used to ask a file-shaped question — does this file contain the text
 * `.catch(`? — which made its exemptions file-shaped too. `recipe.ts` declares
 * nineteen schemas, one of which is legitimately exempt and four of which are the
 * stored `recipes` document. This module answers the narrower question the guard
 * actually wants: for each `.catch()` call site, which declared symbol (and, on
 * an object property, which field) is it attached to.
 *
 * Extracted per `docs/one-shot-scripts.md` §2 — the judgement lives in a tested
 * `scripts/lib/` module, the assertion and the allowlist stay in the test.
 *
 * ── How a call site is attributed ──────────────────────────────────────────
 *
 * TypeScript's own parser (`ts.createSourceFile`, no program, no type checker),
 * then a walk from the `.catch()` call up its parent chain to the nearest
 * enclosing `VariableDeclaration` — the symbol — collecting every
 * `PropertyAssignment` name passed on the way, innermost last. So
 * `z.object({ metadata: z.object({ servings: z.number().catch(0) }) })` assigned
 * to `RecipeSchema` reports `symbol: 'RecipeSchema'`, `field:
 * 'metadata.servings'`. That granularity is what #1114's own instance needed:
 * `ShoppingListItemSchema.matchState` was a property, not a top-level const.
 *
 * ── Zod `.catch(value)` vs Promise `.catch(handler)` ───────────────────────
 *
 * Both spell `.catch(`, and only the first has anything to do with #1114. A call
 * is treated as a Promise's only when it carries positive evidence of one:
 * either its argument list is empty (Zod's `.catch()` always requires an
 * argument — a fallback value or a callback — so an empty one cannot be Zod's),
 * or the chain it hangs off is rooted at the identifier `Promise`, passes
 * through a `.then(`, or the call itself is the direct operand of an `await`.
 * Everything else — including a lone-handler argument on a chain rooted at
 * `WeekdayEnum`, a local alias, a record/array element, or a function call — is
 * Zod's. Erring towards "Zod" is deliberate — a misclassified Promise `.catch()`
 * reds a guard someone then reads, a misclassified Zod one is silent, so the
 * classifier fails CLOSED: proof of Promise is required, not proof of Zod.
 *
 * No schema file holds a Promise `.catch()` today, so this closes a latent false
 * positive rather than fixing a live one.
 *
 * ── Honest limits ──────────────────────────────────────────────────────────
 *
 * It reads one file's source at a time, with no type information:
 *
 * - It sees `.catch` written as a property access. A `.catch()` reached through
 *   a variable (`const m = 'catch'; s[m](…)`), applied by a helper
 *   (`withCatch(schema)`), or composed into this directory from outside it, is
 *   not seen at all.
 * - The Zod/Promise split above is a heuristic over syntax, not a type. A
 *   genuine Promise `.catch(handler)` whose promise is neither rooted at
 *   `Promise`, chained through `.then(`, nor `await`ed at the call site itself
 *   — stored in a variable and awaited on a later line, say — is reported as a
 *   Zod catch. That is the safe direction stated above: it reds a guard someone
 *   reads rather than silently waving a Zod `.catch()` through.
 * - Attribution needs an enclosing `VariableDeclaration` or `FunctionDeclaration`.
 *   A call with neither — a bare `export default …` — reports the symbol
 *   `<anonymous>`, which is a real key and will red the guard rather than vanish
 *   from it.
 * - A computed property name reports the field `<computed>`, for the same reason.
 * - Comments cannot produce a call expression, so a file may DISCUSS `.catch()`
 *   freely. That is now a property of parsing rather than of a regex that
 *   stripped comments first.
 */

import ts from 'typescript';

/** Placeholder symbol for a call site with no enclosing named declaration. */
export const ANONYMOUS = '<anonymous>';

/** Placeholder field for `{ [expr]: … }`. */
export const COMPUTED = '<computed>';

/** Unwrap a call/property chain down to whatever identifier it starts from. */
const chainRoot = (node) => {
  let current = node;
  for (;;) {
    if (
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current) ||
      ts.isCallExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
};

/** Does the chain `.catch` hangs off pass through a `.then(` anywhere? */
const chainHasThen = (expression) => {
  let current = expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      if (current.name.text === 'then') return true;
      current = current.expression;
      continue;
    }
    if (
      ts.isElementAccessExpression(current) ||
      ts.isCallExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return false;
  }
};

/**
 * Is this `.catch(...)` call itself the direct operand of an `await` —
 * `await x.catch(...)`, or `await x.catch(...).y()` — walking up through the
 * chain built on top of it? A promise merely stored in a variable and awaited
 * on a later line is not seen; that is the documented, safe-direction limit.
 */
const isAwaitedDirectly = (call) => {
  let current = call;
  for (;;) {
    const { parent } = current;
    if (!parent) return false;
    if (ts.isAwaitExpression(parent)) return true;
    if (
      ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isParenthesizedExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (ts.isCallExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }
    return false;
  }
};

/**
 * Positive evidence that a `.catch(...)` call is a Promise's, not Zod's. Zod's
 * `.catch()` always takes an argument, so an empty argument list can only be a
 * Promise's; otherwise the chain must root at `Promise`, run through `.then(`,
 * or be `await`ed directly — see the header's Zod/Promise section.
 */
const isPromiseCatch = (call) => {
  if (call.arguments.length === 0) return true;
  const root = chainRoot(call.expression);
  if (ts.isIdentifier(root) && root.text === 'Promise') return true;
  if (chainHasThen(call.expression)) return true;
  return isAwaitedDirectly(call);
};

const isZodCatch = (call) => !isPromiseCatch(call);

const propertyName = (name) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : COMPUTED;

/** Nearest enclosing declaration name, plus the property path walked to reach it. */
const attribute = (call) => {
  const fields = [];
  for (let node = call.parent; node; node = node.parent) {
    if (ts.isPropertyAssignment(node)) {
      fields.unshift(propertyName(node.name));
    } else if (ts.isVariableDeclaration(node)) {
      const symbol = ts.isIdentifier(node.name) ? node.name.text : ANONYMOUS;
      return { symbol, field: fields.length > 0 ? fields.join('.') : null };
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      return { symbol: node.name.text, field: fields.length > 0 ? fields.join('.') : null };
    }
  }
  return { symbol: ANONYMOUS, field: fields.length > 0 ? fields.join('.') : null };
};

/**
 * The allowlist key for a call site: `file#Symbol`, or `file#Symbol.field` when
 * the call sits on an object property.
 */
export const catchSiteKey = ({ file, symbol, field }) =>
  `${file}#${symbol}${field === null || field === undefined ? '' : `.${field}`}`;

/**
 * Every Zod `.catch()` call site in one TypeScript source, in source order.
 *
 * @param {string} source - the file's text.
 * @param {string} file - the name reported back on each site; the guard passes a
 *   bare filename, so keys read `recipe.ts#RecipeSchema`.
 * @returns {{file: string, symbol: string, field: string|null, line: number, key: string}[]}
 */
export const findCatchSites = (source, file) => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const sites = [];

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch' &&
      isZodCatch(node)
    ) {
      const { symbol, field } = attribute(node);
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.expression.name.getStart(sourceFile)).line +
        1;
      sites.push({ file, symbol, field, line, key: catchSiteKey({ file, symbol, field }) });
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return sites;
};
