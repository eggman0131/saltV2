// spec: ui-spec-v02.md §8.13 v0.2.19
/**
 * The variant maps Stack, Inline and Grid share.
 *
 * `gap` was written out three times and `align`/`justify` twice, identically —
 * `Stack.variants.ts` and `Inline.variants.ts` differed in two lines out of
 * thirty-one, the exported name and `flex-col` vs `flex-row`. One table now, so
 * adding a gap step is one edit rather than three that can disagree.
 *
 * Only the maps are shared. Each primitive keeps its own `cva` call, base class,
 * `defaultVariants`, exported name and `VariantProps` type — the base class is
 * the thing that genuinely differs, and it stays where it belongs (§8.13).
 * `Grid`'s `cols` map has one caller and stays in `Grid.variants.ts`.
 *
 * The keys are the primitives' public prop unions: `tests/Layout.types.test-d.ts`
 * pins that `StackVariants`, `InlineVariants` and `GridVariants` still infer them
 * from here, because nothing else in the package consumes those three types.
 */

export const gapVariants = {
  '0': 'gap-0',
  '1': 'gap-1',
  '2': 'gap-2',
  '3': 'gap-3',
  '4': 'gap-4',
  '6': 'gap-6',
  '8': 'gap-8',
} as const;

export const alignVariants = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
} as const;

export const justifyVariants = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const;
