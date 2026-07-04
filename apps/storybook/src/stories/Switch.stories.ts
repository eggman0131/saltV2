import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { Switch } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts for why Svelte CSF is not
// used under Vite 8. Switch is a plain form primitive (no compound children) so
// it is driven directly. `label` is REQUIRED by the component contract and gives
// the control its accessible name.
const meta = {
  title: 'Primitives/Switch',
  component: Switch,
  args: {
    label: 'Show weather on the planner',
    checked: false,
    size: 'md',
    disabled: false,
    required: false,
  },
  argTypes: {
    label: { control: 'text' },
    checked: { control: 'boolean' },
    description: { control: 'text' },
    error: { control: 'text' },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives real Switch props.
export const Playground: Story = {};

export const Off: Story = { args: { checked: false } };
export const On: Story = { args: { checked: true } };

// Description helper text under the label.
export const WithDescription: Story = {
  args: {
    label: 'Offline mode',
    description: 'Keep the last synced data available without a connection.',
  },
};

export const Disabled: Story = { args: { disabled: true, checked: true } };

// Size scale.
export const Small: Story = { args: { size: 'sm', label: 'Small' } };
export const Large: Story = { args: { size: 'lg', label: 'Large' } };
