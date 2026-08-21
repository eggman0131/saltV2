import type { Meta, StoryObj } from '@storybook/svelte-vite';
import CollapsibleSectionDemo from './_wrappers/CollapsibleSectionDemo.svelte';

// Driven through a wrapper because the open state belongs to the page
// (ui-spec-v09 §8.25.4) — a story that pinned `expanded` as an arg could never
// be clicked open.
const meta = {
  title: 'Primitives/CollapsibleSection',
  component: CollapsibleSectionDemo,
  args: {
    title: 'Produce',
    withCount: true,
    withAction: false,
    startExpanded: true,
  },
  argTypes: {
    title: { control: 'text' },
    withCount: { control: 'boolean' },
    withAction: { control: 'boolean' },
    startExpanded: { control: 'boolean' },
  },
} satisfies Meta<typeof CollapsibleSectionDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Expanded: Story = { args: { startExpanded: true } };

// The count shows only while collapsed — folded away, the header has to say how
// much it is hiding.
export const Collapsed: Story = { args: { startExpanded: false } };

// A section that carries its own count in the title needs no `collapsedCount`.
export const WithoutCount: Story = {
  args: { title: 'Checked (4)', withCount: false, startExpanded: false },
};

// Trailing header control, acting on the whole section.
export const WithAction: Story = {
  args: { title: 'Checked (4)', withCount: false, withAction: true },
};
