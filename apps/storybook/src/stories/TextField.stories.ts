import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { TextField } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts for why Svelte CSF is not
// used under Vite 8.
const meta = {
  title: 'Primitives/TextField',
  component: TextField,
  // A label is always supplied so the rendered <input> has an accessible name —
  // keeps the a11y panel clean by default.
  args: {
    label: 'Email',
    placeholder: 'you@example.com',
    size: 'md',
    required: false,
    disabled: false,
    readonly: false,
  },
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    label: { control: 'text' },
    placeholder: { control: 'text' },
    description: { control: 'text' },
    error: { control: 'text' },
    required: { control: 'boolean' },
    disabled: { control: 'boolean' },
    readonly: { control: 'boolean' },
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives real TextField props.
export const Playground: Story = {};

// Error state: aria-invalid + role="alert" message.
export const WithError: Story = {
  args: {
    value: 'not-an-email',
    error: 'Enter a valid email address',
    required: true,
  },
};

// Description helper text below the field.
export const WithDescription: Story = {
  args: {
    label: 'Username',
    placeholder: 'jane',
    description: 'This is how your name appears to other family members.',
  },
};

// Disabled.
export const Disabled: Story = { args: { disabled: true } };
