import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (ToastDemo.svelte): Toast needs a
// ToastProvider ancestor + a ToastViewport, which a single `component` + `args`
// cannot express. The wrapper holds the toast open with `duration={0}` (no
// auto-dismiss) so it renders statically. It imports ONLY @salt/ui-components
// (Rule 7); see Button.stories.ts for why Svelte CSF is not used under Vite 8.
import ToastDemo from './_wrappers/ToastDemo.svelte';

const meta = {
  title: 'Primitives/Toast',
  component: ToastDemo,
  args: {
    variant: 'default',
    withAction: false,
  },
  argTypes: {
    variant: { control: 'radio', options: ['default', 'destructive', 'success'] },
    withAction: { control: 'boolean' },
  },
} satisfies Meta<typeof ToastDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Neutral toast (bottom-right of the canvas).
export const Default: Story = { args: { variant: 'default' } };

// Destructive: role="alert" / assertive live region.
export const Destructive: Story = { args: { variant: 'destructive' } };

// Success.
export const Success: Story = { args: { variant: 'success' } };

// With an inline action (e.g. Undo).
export const WithAction: Story = { args: { withAction: true } };
