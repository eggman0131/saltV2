import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a showcase wrapper (EmptyStateDemo.svelte): the
// icon/actions snippets render live Icon/Button components, which createRawSnippet
// can't do, so booleans toggle each variant. The wrapper imports ONLY
// @salt/ui-components (Rule 7); see Button.stories.ts for why Svelte CSF is not
// used under Vite 8.
import EmptyStateDemo from './_wrappers/EmptyStateDemo.svelte';

const meta = {
  title: 'Primitives/EmptyState',
  component: EmptyStateDemo,
  args: {
    title: 'No recipes yet',
    description: '',
    showIcon: false,
    showActions: false,
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    showIcon: { control: 'boolean' },
    showActions: { control: 'boolean' },
  },
} satisfies Meta<typeof EmptyStateDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Title only (empty description → not rendered).
export const TitleOnly: Story = {};

// Title + description.
export const WithDescription: Story = {
  args: { description: 'Recipes you add will show up here.' },
};

// With a leading Icon (via the `icon` snippet).
export const WithIcon: Story = {
  args: { description: 'Recipes you add will show up here.', showIcon: true },
};

// With action Buttons (via the `actions` snippet).
export const WithActions: Story = {
  args: { description: 'Add your first recipe to get started.', showActions: true },
};
