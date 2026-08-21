import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { createRawSnippet } from 'svelte';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { Chip } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts for why Svelte CSF is not
// used under Vite 8. A chip's only child is its text label, built here with
// createRawSnippet (Svelte 5) so a plain .ts story can supply it.
const label = (text: string) => createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

const meta = {
  title: 'Primitives/Chip',
  component: Chip,
  args: {
    variant: 'filter',
    pressed: false,
    children: label('Weeknight'),
  },
  argTypes: {
    variant: { control: 'select', options: ['filter', 'expander'] },
    pressed: { control: 'boolean' },
    // The label snippet is not a user-facing control.
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives real Chip props.
export const Playground: Story = {};

export const Unpressed: Story = { args: { pressed: false, children: label('#weeknight') } };
export const Pressed: Story = { args: { pressed: true, children: label('#weeknight') } };

// The dashed chip that ends a truncated row. It is an action, not a state, so it
// carries no `aria-pressed` however `pressed` is set (ui-spec-v09 §8.23.6).
export const Expander: Story = {
  args: { variant: 'expander', children: label('+3 more') },
};

export const ExpanderCollapse: Story = {
  args: { variant: 'expander', children: label('Show less') },
};
