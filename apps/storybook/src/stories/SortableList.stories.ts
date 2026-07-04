import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (SortableListDemo.svelte):
// SortableList is generic (<T>) with required `items`/`getId`/`onReorder` and a
// `row` snippet that a single `component` + `args` cannot express. The wrapper
// fixes a concrete item type and holds the list in `$state`. Reordering is
// pointer-driven (drag a row) — a visual/interaction showcase. It imports ONLY
// @salt/ui-components (Rule 7); see Button.stories.ts for why Svelte CSF is not
// used under Vite 8.
import SortableListDemo from './_wrappers/SortableListDemo.svelte';

const meta = {
  title: 'Primitives/SortableList',
  component: SortableListDemo,
} satisfies Meta<typeof SortableListDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// A reorderable list of rows. Drag a row to reorder (pointer-driven).
export const Default: Story = {};
