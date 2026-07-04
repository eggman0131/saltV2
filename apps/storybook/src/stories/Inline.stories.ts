import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Inline (horizontal flex) needs children + a sized frame to show
// gap/align/justify, so the story `component` is a demo wrapper
// (InlineDemo.svelte) that forwards those as live controls. InlineDemo imports
// ONLY @salt/ui-components (Rule 7).
import InlineDemo from './_wrappers/InlineDemo.svelte';

const meta = {
  title: 'Primitives/Inline',
  component: InlineDemo,
  args: {
    gap: '4',
    align: 'stretch',
    justify: 'start',
  },
  argTypes: {
    gap: { control: 'select', options: ['0', '1', '2', '3', '4', '6', '8'] },
    align: { control: 'select', options: ['start', 'center', 'end', 'stretch'] },
    justify: { control: 'select', options: ['start', 'center', 'end', 'between'] },
  },
} satisfies Meta<typeof InlineDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives gap / align / justify.
export const Playground: Story = {};

// align is the cross (vertical) axis for a horizontal inline row.
export const AlignCenter: Story = { args: { align: 'center' } };
export const AlignEnd: Story = { args: { align: 'end' } };

// justify is the main (horizontal) axis.
export const JustifyBetween: Story = { args: { justify: 'between' } };
