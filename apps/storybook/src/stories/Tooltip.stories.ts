import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (TooltipDemo.svelte): Tooltip is
// a compound overlay (trigger + content) whose root self-embeds its Provider — a
// single `component` + `args` cannot express it. A controlled `open` arg forces
// the tooltip visible for the static stories (otherwise it opens on hover/focus).
// It imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts for why
// Svelte CSF is not used under Vite 8.
import TooltipDemo from './_wrappers/TooltipDemo.svelte';

const meta = {
  title: 'Primitives/Tooltip',
  component: TooltipDemo,
  args: {
    open: false,
    side: 'top',
    content: 'Adds this item to the shared shopping list',
  },
  argTypes: {
    open: { control: 'boolean' },
    side: { control: 'radio', options: ['top', 'right', 'bottom', 'left'] },
    content: { control: 'text' },
  },
} satisfies Meta<typeof TooltipDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default: closed; opens on hover/focus after the delay.
export const Default: Story = { args: { open: false } };

// Forced open so the content (dark surface, by design) is visible statically.
export const Open: Story = { args: { open: true } };

// Placement variants (all forced open).
export const Right: Story = { args: { open: true, side: 'right' } };
export const Bottom: Story = { args: { open: true, side: 'bottom' } };
export const Left: Story = { args: { open: true, side: 'left' } };
