import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (SelectableListDemo.svelte):
// SelectableList is generic (<T extends {id}>), driven by a runes `ListSelection`
// controller (createListSelection) and a required `row` snippet that a single
// `component` + `args` cannot express. The wrapper imports ONLY @salt/ui-components
// (Rule 7); see Button.stories.ts for why Svelte CSF is not used under Vite 8.
import SelectableListDemo from './_wrappers/SelectableListDemo.svelte';

const meta = {
  title: 'Templates/SelectableList',
  component: SelectableListDemo,
  args: {
    selectionMode: true,
  },
  argTypes: {
    selectionMode: { control: 'boolean' },
  },
} satisfies Meta<typeof SelectableListDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Selection mode on: each row shows a checkbox, a select-all control sits above,
// and two rows are pre-selected (ring + checked).
export const Default: Story = {};

// Selection mode off: plain rows, no checkboxes, no select-all bar.
export const NonSelectable: Story = { args: { selectionMode: false } };
