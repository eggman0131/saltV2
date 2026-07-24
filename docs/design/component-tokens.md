# Promoting a Visual Fix to a Token

Instructions for an agent (Sonnet) when the user spots a component that "looks wrong" and asks to fix it via a token. Follow this recipe — do not invent tokens speculatively.

## Trigger

The user names a specific visual problem and a target value, e.g.:

> "Make the checkbox 20px × 20px and add a token following these guidelines."

If the user only describes a problem without a target value, ask for the target before proceeding.

## Principle

Tokens are promoted **reactively**, not speculatively. One real visual problem → one token (or one token family if siblings should match: checkbox/radio/switch, button sizes, etc.). Do not add tokens for cases that haven't surfaced.

## Files to touch (in this order)

1. **`docs/design/design.md`** — the source of truth. Add the new value under the relevant frontmatter section (`spacing`, `rounded`, or the `controls:` block for component primitives). If the YAML schema needs a new key, also extend `packages/ui-components/scripts/check-theme.ts` so drift is detected (the `CONTROLS_CHECKBOX_MAP` / `CONTROLS_SWITCH_MAP` pattern: one design.md key → one CSS var).
2. **`packages/ui-components/src/salt.css`** — mirror the value. This is the CSS-first design-system entry; there is no `tailwind-preset.ts` any more. Component-level sizes are declared as `--salt-*` custom properties in the `@theme` block and consumed by the matching `.salt-{component}--{size}` rule in `@layer components` (e.g. `--salt-control-checkbox-md`, read by `.salt-control--checkbox-md`). New shared scales go in `@theme`; new custom utilities go in an `@utility` block.
3. **`packages/ui-components/src/tokens/*.ts`** — do **not** hand-edit. These are generated from `salt.css` by `scripts/generate-tokens.ts`; run `pnpm --filter @salt/ui-components generate-tokens` and commit the result if your value lands in a generated family (colors/radius/motion/elevation/z-index/typography).
4. **`packages/ui-components/tests/tokens.theme.test.ts`** — add a focused assertion that pins the new value. One test per token. The test reads `salt.css` as text, so assertions are `expect(css).toMatch(/--salt-control-checkbox-md:\s*16px/)`-shaped — match the style of the existing blocks.
5. **`packages/ui-components/src/primitives/{Component}.svelte`** (or wherever the primitive consumes the class) — refactor to use the token class. Remove any hardcoded value the token now replaces.
6. **Storybook** — verify the affected component in Storybook (`pnpm --filter @salt/storybook storybook`) renders correctly. Check sibling components (radio, switch) if the change implies they should match.

## Verification

After the edits, run:

```
pnpm --filter @salt/ui-components test
pnpm theme:check
pnpm typecheck
pnpm lint
```

`pnpm theme:check` is the drift detector between `design.md` and `salt.css` — it must pass. If it doesn't, the YAML and the stylesheet disagree.

## Worked example: "Make the checkbox 20px × 20px"

The current `md` checkbox is 16px. The user wants 20px. Steps:

- `design.md` — update the existing `controls:` block (it is already there; this is an edit, not a new key):
  ```yaml
  controls:
    checkbox:
      sm: 14px
      md: 20px
      lg: 18px
  ```
- `check-theme.ts` — nothing to do here: `controls.checkbox.md` is already mapped to `--salt-control-checkbox-md`. You only touch this file when introducing a key the map doesn't cover.
- `salt.css` — change `--salt-control-checkbox-md` from `16px` to `20px` in the `@theme` block. The `.salt-control--checkbox-md` rule reads the var and needs no edit. Decide whether radio indicator and switch sizes should track this; if yes, update their vars in the same change.
- `tokens.theme.test.ts` — update the assertion that pins the value (`expect(css).toMatch(/--salt-control-checkbox-md:\s*20px/)`), matching the style used for the other control primitives.
- Verify the affected component in Storybook (`pnpm --filter @salt/storybook storybook`) and confirm visually.

## What NOT to do

- Do not add a token without a concrete visual problem driving it.
- Do not add tokens for "every size we might want one day" — add only what's named.
- Do not skip `design.md`. `salt.css` is downstream of it; `theme:check` will fail if you only edit the stylesheet.
- Do not skip the test. A token without a test silently regresses.
- Do not refactor unrelated components in the same change.
