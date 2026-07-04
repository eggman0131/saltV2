import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (DialogDemo.svelte): Dialog is a
// context-driven compound overlay (trigger + portalled content) that a single
// `component` + `args` cannot express. The wrapper forces `portal={false}` so the
// content renders inline and exposes a controlled `open` arg to force the modal
// open. It imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts for
// why Svelte CSF is not used under Vite 8.
import DialogDemo from './_wrappers/DialogDemo.svelte';

const meta = {
  title: 'Primitives/Dialog',
  component: DialogDemo,
  args: {
    open: false,
    size: 'md',
  },
  argTypes: {
    open: { control: 'boolean' },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'xl', 'full'] },
  },
} satisfies Meta<typeof DialogDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Closed: only the trigger button is shown.
export const Closed: Story = { args: { open: false } };

// Open: the modal (overlay + content) renders inline.
export const Open: Story = { args: { open: true } };

// Size scale (all shown open).
export const Small: Story = { args: { open: true, size: 'sm' } };
export const Large: Story = { args: { open: true, size: 'lg' } };
export const ExtraLarge: Story = { args: { open: true, size: 'xl' } };
