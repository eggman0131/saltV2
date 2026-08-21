import type { Meta, StoryObj } from '@storybook/svelte-vite';
import ChipGroupDemo from './_wrappers/ChipGroupDemo.svelte';

// The row, exercised through a wrapper because a group's whole subject is its
// children — the three shapes the recipe list actually ships: a single-select
// row, a multi-select row, and a truncated row ending in an expander.
const meta = {
  title: 'Primitives/ChipGroup',
  component: ChipGroupDemo,
  args: { mode: 'single', ariaLabel: 'Section' },
  argTypes: {
    mode: { control: 'select', options: ['single', 'multi', 'truncated'] },
    ariaLabel: { control: 'text' },
  },
} satisfies Meta<typeof ChipGroupDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// Exactly one pressed at all times. Single-select is a property of what the
// page does on click, not of the chip or the group (ui-spec-v09 §8.24.2).
export const SingleSelect: Story = { args: { mode: 'single', ariaLabel: 'Section' } };

// Independent toggles that narrow together.
export const MultiSelect: Story = { args: { mode: 'multi', ariaLabel: 'Tags' } };

// Capped row plus its dashed expander. The cap is the page's decision; the group
// does not count its children (§8.24.5).
export const Truncated: Story = { args: { mode: 'truncated', ariaLabel: 'Tags' } };

// Omitting `ariaLabel` leaves a plain <div> rather than an unnamed role="group".
export const Unnamed: Story = { args: { mode: 'multi', ariaLabel: undefined } };
