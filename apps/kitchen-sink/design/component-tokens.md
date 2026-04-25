# Promoting a Visual Fix to a Token

Instructions for an agent (Sonnet) when the user spots a component that "looks wrong" and asks to fix it via a token. Follow this recipe — do not invent tokens speculatively.

## Trigger

The user names a specific visual problem and a target value, e.g.:

> "Make the checkbox 20px × 20px and add a token following these guidelines."

If the user only describes a problem without a target value, ask for the target before proceeding.

## Principle

Tokens are promoted **reactively**, not speculatively. One real visual problem → one token (or one token family if siblings should match: checkbox/radio/switch, button sizes, etc.). Do not add tokens for cases that haven't surfaced.

## Files to touch (in this order)

1. **`apps/kitchen-sink/design/design.md`** — the source of truth. Add the new value under the relevant frontmatter section (`spacing`, `rounded`, or a new `controls:` block for component primitives). If the YAML schema needs a new top-level key, also extend `packages/ui-components/scripts/check-theme.ts` so drift is detected.
2. **`packages/ui-components/src/tailwind-preset.ts`** — mirror the value. For component-level sizes, edit the relevant `.salt-{component}--{size}` rule in `saltComponentPlugin` (e.g. `.salt-control--checkbox-md`). For new shared scales, add an entry under `theme.extend` and/or a CSS var in `cssVarsPlugin`.
3. **`packages/ui-components/src/tokens/*.ts`** — add a typed export only if the value is referenced from TS (most component sizes don't need this; colors/radius/motion do).
4. **`packages/ui-components/tests/tokens.preset.test.ts`** — add a focused assertion that pins the new value. One test per token. Match the style of existing `it('...', () => { expect(...).toBe(...) })` blocks.
5. **`packages/ui-components/src/primitives/{Component}.svelte`** (or wherever the primitive consumes the class) — refactor to use the token class. Remove any hardcoded value the token now replaces.
6. **`apps/kitchen-sink`** — verify the affected page in the kitchen-sink renders correctly. Check sibling components (radio, switch) if the change implies they should match.

## Verification

After the edits, run:

```
pnpm --filter @salt/ui-components test
pnpm theme:check
pnpm typecheck
pnpm lint
```

`pnpm theme:check` is the drift detector between `design.md` and the preset — it must pass. If it doesn't, the YAML and the preset disagree.

## Worked example: "Make the checkbox 20px × 20px"

The current `md` checkbox is `h-4 w-4` (16px). The user wants 20px (`h-5 w-5`). Steps:

- `design.md` — add (or update) under a new `controls:` block:
  ```yaml
  controls:
    checkbox:
      sm: 14px
      md: 20px
      lg: 24px
  ```
- `check-theme.ts` — extend the schema to validate the `controls.checkbox.*` keys against the preset (mirror the `SPACING_KEYS` pattern).
- `tailwind-preset.ts` — change `.salt-control--checkbox-md` from `h-4 w-4` to `h-5 w-5`. Decide whether radio indicator and switch sizes should track this; if yes, update them in the same change.
- `tokens.preset.test.ts` — add `it('checkbox md is h-5 w-5', ...)` that introspects the plugin output, matching the style used for `salt-focus-ring`.
- Run kitchen-sink and confirm visually.

## What NOT to do

- Do not add a token without a concrete visual problem driving it.
- Do not add tokens for "every size we might want one day" — add only what's named.
- Do not skip `design.md`. The preset is downstream of it; `theme:check` will fail if you only edit the preset.
- Do not skip the test. A token without a test silently regresses.
- Do not refactor unrelated components in the same change.
