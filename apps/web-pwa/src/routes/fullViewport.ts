// Full-viewport routes (issue #641) — the ones that own the whole screen and run
// WITHOUT the app shell's navigation chrome. App.svelte turns this into AppShell's
// `chrome` prop; ui-spec-v05 §2 holds the pattern and the obligations that come
// with adding one.
//
// The bar is a genuinely modal, single-task mode — NOT a layout that is merely
// awkward inside the shell. Both members are cook mode: cooking is heads-down and
// hands-busy, so a nav bar you can fat-finger mid-step is a hazard rather than an
// escape hatch. It is also why the chrome must not simply be painted over: covered
// nav stays focusable and stays in the accessibility tree.
//
// The second entry is the GUIDED cook (issue #751) — the same act, the same mode,
// read through the recipe's guided plan. It is a route of its own rather than a
// flag on the first because the two pages differ in what mise en place IS, and
// which one you get is chosen at the moment you start cooking. Note what is NOT
// here: `/recipes/:id/guided`, the plan EDITOR, which is desk work inside the
// ordinary shell.
//
// Kept in its own module, deliberately: `./index.ts` eagerly imports every
// non-lazy page, so importing the route table to ask this one question would drag
// the whole app in behind it (and out of a unit test's reach).
const FULL_VIEWPORT_ROUTES = [
  /^\/recipes\/[^/]+\/cook$/,
  /^\/recipes\/[^/]+\/cook\/guided$/,
] as const;

/**
 * Whether `location` — svelte-spa-router's path, with no leading `#` — is a
 * full-viewport route.
 */
export function isFullViewportRoute(location: string): boolean {
  return FULL_VIEWPORT_ROUTES.some((re) => re.test(location));
}
