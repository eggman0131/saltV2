// spec: SPEC.md §3.5 v0.2.3
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the Salt typography scale (tailwind-preset.ts → theme.fontSize)
// so size tokens are treated as font-size utilities and don't collapse against
// the text-color group (e.g. `text-foreground`).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'h1', 'h2', 'body-lg', 'body-md', 'label-caps'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
