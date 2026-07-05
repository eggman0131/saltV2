// spec: SPEC.md §3.5 v0.2.3
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the Salt typography scale (salt.css @theme --text-*)
// so size tokens are treated as font-size utilities and don't collapse against
// the text-color group (e.g. `text-foreground`). tailwind-merge v3 registers
// custom font sizes on the `text` theme namespace (mirroring Tailwind v4's
// `--text-*`), not by extending the `font-size` classGroup as in v2.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'h1', 'h2', 'body-lg', 'body-md', 'label-caps'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
