import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { Checkbox } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts for why Svelte CSF is not
// used under Vite 8. Checkbox renders a label + optional description/error, so it
// is driven directly (no wrapper). A label is always supplied so the control has
// an accessible name (clean a11y panel).
//
// `checked` is `boolean | 'indeterminate'`, so its control is a select with the
// three reachable states rather than a plain boolean toggle.
const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  args: {
    label: 'Email me new recipes',
    checked: false,
    size: 'md',
    disabled: false,
    required: false,
  },
  argTypes: {
    checked: { control: 'select', options: [false, true, 'indeterminate'] },
    label: { control: 'text' },
    description: { control: 'text' },
    error: { control: 'text' },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives real Checkbox props.
export const Playground: Story = {};

export const Unchecked: Story = { args: { checked: false } };
export const Checked: Story = { args: { checked: true } };

// Tri-state: neither checked nor unchecked (e.g. a partially-selected group).
export const Indeterminate: Story = { args: { checked: 'indeterminate' } };

// Description helper text under the label.
export const WithDescription: Story = {
  args: {
    label: 'Weekly digest',
    description: 'A Sunday summary of everything added to the shopping list.',
  },
};

// Error state: aria-invalid + role="alert" message.
export const WithError: Story = {
  args: {
    label: 'Accept the household rules',
    error: 'You must accept before continuing',
    required: true,
  },
};

export const Disabled: Story = { args: { disabled: true, checked: true } };

// Size scale.
export const Small: Story = { args: { size: 'sm', label: 'Small' } };
export const Large: Story = { args: { size: 'lg', label: 'Large' } };
