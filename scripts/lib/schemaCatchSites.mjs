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
 * is treated as Zod's unless BOTH of these hold: its argument list is a lone
 * function (arrow or `function` expression) or empty, AND the chain it hangs off
 * does not root at `z` or at an identifier ending in `Schema`. Erring towards
 * "Zod" is deliberate — a misclassified Promise `.catch()` reds a guard someone
 * then reads, a misclassified Zod one is silent.
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
 * - The Zod/Promise split above is a heuristic over syntax, not a type. A Promise
 *   chain rooted at an identifier ending in `Schema` is reported as a Zod catch.
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

/** `z.string()…` or `SomeSchema.…` — the two shapes a Zod chain starts with here. */
const rootsInZod = (expression) => {
  const root = chainRoot(expression);
  return ts.isIdentifier(root) && (root.text === 'z' || root.text.endsWith('Schema'));
};

/** `.catch(err => …)` / `.catch(function (e) {…})` / `.catch()` — the Promise shape. */
const takesOnlyAHandler = (call) =>
  call.arguments.length === 0 ||
  (call.arguments.length === 1 &&
    (ts.isArrowFunction(call.arguments[0]) || ts.isFunctionExpression(call.arguments[0])));

const isZodCatch = (call) => rootsInZod(call.expression) || !takesOnlyAHandler(call);

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
