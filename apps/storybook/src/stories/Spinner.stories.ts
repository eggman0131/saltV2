import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { Spinner } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts.
const meta = {
  title: 'Primitives/Spinner',
  component: Spinner,
  args: {
    size: 24,
    ariaLabel: 'Loading',
  },
  argTypes: {
    size: { control: { type: 'number', min: 8, max: 96, step: 4 } },
    ariaLabel: { control: 'text' },
    class: { control: 'text' },
  },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives the spinner size.
export const Playground: Story = {};

export const Size16: Story = { args: { size: 16 } };
export const Size24: Story = { args: { size: 24 } };
export const Size32: Story = { args: { size: 32 } };
export const Size48: Story = { args: { size: 48 } };
