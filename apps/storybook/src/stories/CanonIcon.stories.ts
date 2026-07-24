import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a showcase wrapper (CanonIconDemo.svelte) so the
// single tri-state tile and the size row live in one file. The wrapper imports
// ONLY @salt/ui-components (Rule 7); see Button.stories.ts for why Svelte CSF is
// not used under Vite 8.
import CanonIconDemo from './_wrappers/CanonIconDemo.svelte';

// An inline data: URI so the "real image" state renders with no network — a
// small rounded tile with a stylised tomato. `thumbnail` is tri-state: a real
// URL renders an <img>; `null`, `''`, or the `"hidden"` sentinel render the
// bare tile only.
const TOMATO =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxMiIgZmlsbD0iI2UwNTMyZiIvPjxjaXJjbGUgY3g9IjMyIiBjeT0iMjQiIHI9IjEyIiBmaWxsPSIjZmZkMzRlIi8+PHJlY3QgeD0iMTQiIHk9IjM4IiB3aWR0aD0iMzYiIGhlaWdodD0iMTQiIHJ4PSI3IiBmaWxsPSIjZmZmIi8+PC9zdmc+';

const meta = {
  title: 'Primitives/CanonIcon',
  component: CanonIconDemo,
  args: {
    thumbnail: TOMATO,
    name: 'Tinned tomatoes',
    size: 48,
    dimmed: false,
    matched: false,
    shimmer: false,
    showSizes: false,
  },
  argTypes: {
    thumbnail: { control: 'text' },
    name: { control: 'text' },
    size: { control: { type: 'number', min: 16, max: 96, step: 2 } },
    dimmed: { control: 'boolean' },
    matched: { control: 'boolean' },
    shimmer: { control: 'boolean' },
    showSizes: { control: 'boolean' },
  },
} satisfies Meta<typeof CanonIconDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Real thumbnail → renders an <img>.
export const WithImage: Story = { args: { thumbnail: TOMATO } };

// No icon yet (`null`) → bare tile.
export const NoIcon: Story = { args: { thumbnail: null } };

// User opted out (`"hidden"` sentinel) → bare tile.
export const Hidden: Story = { args: { thumbnail: 'hidden' } };

// Matched but no icon yet (the CF generates it asynchronously): the bare tile
// reads sage with the item's initial — the "found its home" resting state. A
// static, deterministic snapshot (the one-shot shimmer is not shown here).
export const Matched: Story = { args: { thumbnail: null, matched: true } };

// Dimmed — e.g. a checked-off shopping-list item.
export const Dimmed: Story = { args: { thumbnail: TOMATO, dimmed: true } };

// The same thumbnail across the sizes the app uses.
export const Sizes: Story = { args: { thumbnail: TOMATO, showSizes: true } };
