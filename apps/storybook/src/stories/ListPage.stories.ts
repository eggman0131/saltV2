import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (ListPageDemo.svelte): ListPage is
// a template with several Snippet slots (children/loading/error/empty/selectionBar)
// and a `bulkActions` array that a single `component` + `args` cannot express. The
// wrapper imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts for why
// Svelte CSF is not used under Vite 8.
import ListPageDemo from './_wrappers/ListPageDemo.svelte';

const meta = {
  title: 'Templates/ListPage',
  component: ListPageDemo,
  args: {
    title: 'Shopping list',
    description: '',
    isLoading: false,
    isError: false,
    isEmpty: false,
    selectionMode: false,
    selectionCount: 0,
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    isLoading: { control: 'boolean' },
    isError: { control: 'boolean' },
    isEmpty: { control: 'boolean' },
    selectionMode: { control: 'boolean' },
    selectionCount: { control: 'number' },
  },
} satisfies Meta<typeof ListPageDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Header + a plain <ul> list rendered via the default children snippet.
export const Default: Story = {};

// Loading state (built-in centred Spinner via `isLoading`).
export const Loading: Story = { args: { isLoading: true } };

// Empty state rendered via the `empty` snippet (an EmptyState primitive).
export const Empty: Story = { args: { isEmpty: true } };

// Error state rendered via the `error` snippet (an ErrorState primitive).
export const Error: Story = { args: { isError: true } };

// Selection mode with a populated selection count: shows the select-all bar and
// the contextual bottom bulk-action bar (Check / Delete / Move…).
export const SelectionMode: Story = {
  args: { selectionMode: true, selectionCount: 2 },
};
