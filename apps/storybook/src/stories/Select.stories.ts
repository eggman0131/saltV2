import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (SelectDemo.svelte): Select is a
// context-driven compound (root + SelectTrigger/SelectContent/SelectItem) that a
// single `component` + `args` cannot express. The wrapper forces `portal={false}`
// so the open menu renders inline in the canvas. It imports ONLY
// @salt/ui-components (Rule 7); see Button.stories.ts for why Svelte CSF is not
// used under Vite 8.
import SelectDemo from './_wrappers/SelectDemo.svelte';

const meta = {
  title: 'Primitives/Select',
  component: SelectDemo,
  args: {
    open: false,
    disabled: false,
    value: '',
    placeholder: 'Pick an aisle',
  },
  argTypes: {
    open: { control: 'boolean' },
    disabled: { control: 'boolean' },
    value: { control: 'select', options: ['', 'produce', 'dairy', 'bakery'] },
    placeholder: { control: 'text' },
  },
} satisfies Meta<typeof SelectDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Closed: just the trigger showing the placeholder.
export const Closed: Story = { args: { open: false } };

// Open: the listbox renders inline (portal disabled) with the item list.
export const Open: Story = { args: { open: true } };

// A pre-selected value shows in the trigger instead of the placeholder.
export const WithValue: Story = { args: { value: 'dairy' } };

// Disabled trigger.
export const Disabled: Story = { args: { disabled: true } };
