import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a showcase wrapper (DividerDemo.svelte): a horizontal
// rule needs width and a vertical rule needs a fixed-height flex row to be
// visible, so both are framed there. The wrapper imports ONLY
// @salt/ui-components (Rule 7); see Button.stories.ts for why Svelte CSF is not
// used under Vite 8.
import DividerDemo from './_wrappers/DividerDemo.svelte';

const meta = {
  title: 'Primitives/Divider',
  component: DividerDemo,
  args: {
    orientation: 'horizontal',
  },
  argTypes: {
    orientation: { control: 'select', options: ['horizontal', 'vertical'] },
  },
} satisfies Meta<typeof DividerDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// A full-width 1px rule between two rows of content.
export const Horizontal: Story = { args: { orientation: 'horizontal' } };

// A 1px rule between inline items in a fixed-height row.
export const Vertical: Story = { args: { orientation: 'vertical' } };
