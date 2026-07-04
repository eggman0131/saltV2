import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Stack (vertical flex) needs children + a sized frame to show gap/align/justify,
// so the story `component` is a demo wrapper (StackDemo.svelte) that forwards
// those as live controls. StackDemo imports ONLY @salt/ui-components (Rule 7).
import StackDemo from './_wrappers/StackDemo.svelte';

const meta = {
  title: 'Primitives/Stack',
  component: StackDemo,
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
} satisfies Meta<typeof StackDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives gap / align / justify.
export const Playground: Story = {};

// align is the cross (horizontal) axis for a vertical stack.
export const AlignCenter: Story = { args: { align: 'center' } };
export const AlignEnd: Story = { args: { align: 'end' } };

// justify is the main (vertical) axis.
export const JustifyBetween: Story = { args: { justify: 'between' } };
