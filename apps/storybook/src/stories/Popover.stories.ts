import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (PopoverDemo.svelte): Popover is
// a context-driven compound overlay that a single `component` + `args` cannot
// express. The wrapper forces `portal={false}` for inline rendering and exposes a
// controlled `open` arg. It imports ONLY @salt/ui-components (Rule 7); see
// Button.stories.ts for why Svelte CSF is not used under Vite 8.
import PopoverDemo from './_wrappers/PopoverDemo.svelte';

const meta = {
  title: 'Primitives/Popover',
  component: PopoverDemo,
  args: {
    open: false,
    side: 'bottom',
    align: 'center',
  },
  argTypes: {
    open: { control: 'boolean' },
    side: { control: 'radio', options: ['top', 'right', 'bottom', 'left'] },
    align: { control: 'radio', options: ['start', 'center', 'end'] },
  },
} satisfies Meta<typeof PopoverDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Closed: only the trigger button is shown.
export const Closed: Story = { args: { open: false } };

// Open below the trigger (default side).
export const Open: Story = { args: { open: true, side: 'bottom' } };

// Placement variants.
export const Top: Story = { args: { open: true, side: 'top' } };
export const Right: Story = { args: { open: true, side: 'right' } };
export const Left: Story = { args: { open: true, side: 'left' } };
