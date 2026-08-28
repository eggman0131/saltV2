import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { PictogramPill } from '@salt/ui-components';

// A drawn object, named (ui-spec-v12 §8.30). Standard CSF3 (.stories.ts) — see
// Button.stories.ts for why Svelte CSF is not used under Vite 8.
//
// An inline data: URI stands in for a Tier-1 pictogram so the story renders with
// no network. The real assets are 128px WebPs framed to `contentMax: 108`, which
// is what the 40px tile is tuned for (ui-spec-v04 §14.6.1).
const PAN =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+PGVsbGlwc2UgY3g9IjU0IiBjeT0iNzAiIHJ4PSI0MCIgcnk9IjIyIiBmaWxsPSIjNDQ0Ii8+PGVsbGlwc2UgY3g9IjU0IiBjeT0iNjQiIHJ4PSI0MCIgcnk9IjIyIiBmaWxsPSIjNzc3Ii8+PHJlY3QgeD0iOTAiIHk9IjU4IiB3aWR0aD0iMzQiIGhlaWdodD0iMTAiIHJ4PSI1IiBmaWxsPSIjNDQ0Ii8+PC9zdmc+';

const meta = {
  title: 'Primitives/PictogramPill',
  component: PictogramPill,
  args: {
    label: 'large frying pan',
    thumbnail: PAN,
  },
  argTypes: {
    label: { control: 'text' },
    thumbnail: { control: 'text' },
    version: { control: 'text' },
    class: { control: 'text' },
  },
} satisfies Meta<typeof PictogramPill>;

export default meta;
type Story = StoryObj<typeof meta>;

// The pill as it ships: a 40px pictogram flush in the round end, the words beside
// it at `text-base`.
export const Playground: Story = {};

// No picture — the vocabulary does not know this object, or its icon has not been
// generated, or the user hid it. Words, no tile, and the full left inset back.
export const NoPicture: Story = { args: { label: 'tagine', thumbnail: null } };

// A long label wraps inside the pill rather than pushing the row sideways.
export const LongLabel: Story = {
  args: { label: 'large heavy-based casserole dish with a lid', class: 'max-w-xs' },
};
