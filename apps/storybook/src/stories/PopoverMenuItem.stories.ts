import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (PopoverMenuDemo.svelte): a menu
// row only reads as itself inside a PopoverContent, and Popover is a
// context-driven compound a single `component` + `args` cannot express. The
// wrapper forces `portal={false}` for inline rendering. It imports ONLY
// @salt/ui-components (Rule 7); see Button.stories.ts for why Svelte CSF is not
// used under Vite 8.
import PopoverMenuDemo from './_wrappers/PopoverMenuDemo.svelte';

const meta = {
  title: 'Primitives/PopoverMenuItem',
  component: PopoverMenuDemo,
  args: { open: true, busy: false, chosen: 'aisle' },
  argTypes: {
    open: { control: 'boolean' },
    busy: { control: 'boolean' },
    chosen: { control: 'radio', options: ['aisle', 'recipe'] },
  },
} satisfies Meta<typeof PopoverMenuDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Every shape at once: the tick column, a plain row, a disabled row, the
// selected row and the destructive one.
export const Menu: Story = {};

// The tick moves and nothing else shifts — the point of `iconVisible`.
export const OtherOptionChosen: Story = { args: { chosen: 'recipe' } };

// `disabled:opacity-50` is in the base, so a row dims because it is disabled and
// not because an author remembered to ask (ui-spec-v14 §8.33.5).
export const Busy: Story = { args: { busy: true } };

// Closed: only the trigger is shown.
export const Closed: Story = { args: { open: false } };
