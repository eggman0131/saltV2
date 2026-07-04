import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (SheetDemo.svelte): Sheet is a
// context-driven compound overlay that a single `component` + `args` cannot
// express. The wrapper forces `portal={false}` for inline rendering and exposes a
// controlled `open` arg to force the sheet open. It imports ONLY
// @salt/ui-components (Rule 7); see Button.stories.ts for why Svelte CSF is not
// used under Vite 8.
import SheetDemo from './_wrappers/SheetDemo.svelte';

const meta = {
  title: 'Primitives/Sheet',
  component: SheetDemo,
  args: {
    open: true,
    side: 'right',
  },
  argTypes: {
    open: { control: 'boolean' },
    side: { control: 'radio', options: ['left', 'right', 'top', 'bottom'] },
  },
} satisfies Meta<typeof SheetDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// One story per side, all shown open.
export const Right: Story = { args: { open: true, side: 'right' } };
export const Left: Story = { args: { open: true, side: 'left' } };
export const Top: Story = { args: { open: true, side: 'top' } };
export const Bottom: Story = { args: { open: true, side: 'bottom' } };

// Closed: only the trigger button is shown.
export const Closed: Story = { args: { open: false } };
