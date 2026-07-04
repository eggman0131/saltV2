import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (TopBarDemo.svelte): TopBar has an
// optional `actions` Snippet slot that a single `component` + `args` cannot express.
// The wrapper imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts for
// why Svelte CSF is not used under Vite 8.
import TopBarDemo from './_wrappers/TopBarDemo.svelte';

const meta = {
  title: 'Layout/TopBar',
  component: TopBarDemo,
  args: {
    title: 'Salt',
    withActions: false,
  },
  argTypes: {
    title: { control: 'text' },
    withActions: { control: 'boolean' },
  },
} satisfies Meta<typeof TopBarDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Title only.
export const Default: Story = {};

// Trailing action buttons via the `actions` snippet.
export const WithActions: Story = { args: { withActions: true } };
