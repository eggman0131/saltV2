import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a showcase wrapper (ErrorStateDemo.svelte): the
// retry callback and custom `actions` snippet render live Buttons, so booleans
// toggle each variant. The wrapper imports ONLY @salt/ui-components (Rule 7);
// see Button.stories.ts for why Svelte CSF is not used under Vite 8.
import ErrorStateDemo from './_wrappers/ErrorStateDemo.svelte';

const meta = {
  title: 'Primitives/ErrorState',
  component: ErrorStateDemo,
  args: {
    title: 'Something went wrong',
    description: 'We couldn’t load your recipes.',
    retryLabel: 'Try again',
    showRetry: false,
    customActions: false,
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    retryLabel: { control: 'text' },
    showRetry: { control: 'boolean' },
    customActions: { control: 'boolean' },
  },
} satisfies Meta<typeof ErrorStateDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default title + description, no retry.
export const Default: Story = {};

// `showRetry` renders the built-in retry button (via onRetry).
export const WithRetry: Story = {
  args: { description: 'Check your connection and try again.', showRetry: true },
};

// A custom `actions` snippet replaces the built-in retry button.
export const CustomActions: Story = { args: { customActions: true } };
