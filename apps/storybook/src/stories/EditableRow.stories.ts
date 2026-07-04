import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (EditableRowDemo.svelte):
// EditableRow renders an <li> and takes `narrow`/`wide` responsive snippets that a
// single `component` + `args` cannot express. It imports ONLY @salt/ui-components
// (Rule 7); see Button.stories.ts for why Svelte CSF is not used under Vite 8.
import EditableRowDemo from './_wrappers/EditableRowDemo.svelte';

const meta = {
  title: 'Primitives/EditableRow',
  component: EditableRowDemo,
  args: {
    selected: false,
    shaded: false,
    withToggle: false,
  },
  argTypes: {
    selected: { control: 'boolean' },
    shaded: { control: 'boolean' },
    withToggle: { control: 'boolean' },
  },
} satisfies Meta<typeof EditableRowDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default row (wide snippet shown at Storybook's default width).
export const Default: Story = {};

// Selected: ring highlight.
export const Selected: Story = { args: { selected: true } };

// Shaded: amber "needs attention" background.
export const Shaded: Story = { args: { shaded: true } };

// With a leading selection Checkbox (rendered when onToggleSelect is provided).
export const WithToggle: Story = { args: { withToggle: true } };

// Selected + toggle together.
export const SelectedWithToggle: Story = { args: { selected: true, withToggle: true } };
