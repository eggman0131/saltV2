import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (RadioGroupDemo.svelte) because
// RadioGroup is a compound component (root + N RadioGroupItem children wired via
// context) that a single `component` + `args` cannot express. The wrapper imports
// ONLY @salt/ui-components (Rule 7); see Button.stories.ts for why Svelte CSF is
// not used under Vite 8.
import RadioGroupDemo from './_wrappers/RadioGroupDemo.svelte';

const meta = {
  title: 'Primitives/RadioGroup',
  component: RadioGroupDemo,
  args: {
    label: 'Notify me about',
    description: '',
    error: '',
    orientation: 'vertical',
    disabled: false,
    value: 'all',
  },
  argTypes: {
    label: { control: 'text' },
    description: { control: 'text' },
    error: { control: 'text' },
    orientation: { control: 'radio', options: ['vertical', 'horizontal'] },
    disabled: { control: 'boolean' },
    value: { control: 'select', options: ['', 'all', 'mentions', 'none'] },
  },
} satisfies Meta<typeof RadioGroupDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default stacked layout with a pre-selected option.
export const Vertical: Story = { args: { orientation: 'vertical' } };

// Options laid out in a row.
export const Horizontal: Story = { args: { orientation: 'horizontal' } };

// Helper text under the group label.
export const WithDescription: Story = {
  args: { description: 'Choose how often the household pings you.' },
};

// Error state: aria-invalid + role="alert" message on the group.
export const WithError: Story = {
  args: { value: '', error: 'Pick a notification preference' },
};

// Whole group disabled.
export const Disabled: Story = { args: { disabled: true } };
