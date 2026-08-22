import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { createRawSnippet } from 'svelte';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { Chip } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts for why Svelte CSF is not
// used under Vite 8. A chip's only child is its text label, built here with
// createRawSnippet (Svelte 5) so a plain .ts story can supply it.
const label = (text: string) => createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

// A leading glyph for the `fact` chip. Raw markup rather than the `Icon`
// primitive because a plain .ts story cannot instantiate a component into a
// snippet; the chip sizes whatever svg it is handed (ui-spec-v09 §8.23.8).
const clockIcon = createRawSnippet(() => ({
  render: () =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
}));

const meta = {
  title: 'Primitives/Chip',
  component: Chip,
  args: {
    variant: 'filter',
    pressed: false,
    children: label('Weeknight'),
  },
  argTypes: {
    variant: { control: 'select', options: ['filter', 'expander', 'fact', 'tag'] },
    pressed: { control: 'boolean' },
    // Neither snippet is a user-facing control.
    children: { table: { disable: true } },
    icon: { table: { disable: true } },
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

// The two static chips (ui-spec-v09 §8.23.8). Both render a <span>: they are
// read, not pressed, so neither is in the tab order and neither ever carries
// `aria-pressed`.
export const Fact: Story = {
  args: { variant: 'fact', children: label('Serves 4') },
};

export const FactWithIcon: Story = {
  args: { variant: 'fact', icon: clockIcon, children: label('Prep 40 min') },
};

// A word someone attached, not a number measured from the dish. Quiet outline,
// and deliberately no icon — one beside an arbitrary tag would be a guess.
export const Tag: Story = {
  args: { variant: 'tag', children: label('weeknight') },
};
