import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Grid needs children to show its layout, so the story `component` is a demo
// wrapper (GridDemo.svelte) that renders boxes and forwards cols/gap as live
// controls. GridDemo imports ONLY @salt/ui-components (Rule 7).
import GridDemo from './_wrappers/GridDemo.svelte';

const meta = {
  title: 'Primitives/Grid',
  component: GridDemo,
  args: {
    cols: 3,
    gap: '4',
  },
  argTypes: {
    cols: { control: 'select', options: [1, 2, 3, 4, 6, 12] },
    gap: { control: 'select', options: ['0', '1', '2', '3', '4', '6', '8'] },
  },
} satisfies Meta<typeof GridDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives cols / gap.
export const Playground: Story = {};

export const TwoColumns: Story = { args: { cols: 2 } };
export const FourColumns: Story = { args: { cols: 4 } };
export const TwelveColumns: Story = { args: { cols: 12, gap: '2' } };
