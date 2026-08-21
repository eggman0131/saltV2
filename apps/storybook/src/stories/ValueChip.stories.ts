import type { Meta, StoryObj } from '@storybook/svelte-vite';
import ValueChipDemo from './_wrappers/ValueChipDemo.svelte';

// The value chip is a SURFACE, not a component (ui-spec-v09 §8.27): one class,
// `valueChipVariants()`, worn by the control that already owns the interaction.
// There is nothing to put in a Controls panel, so the story is the shape it
// exists for — the catalog's review row, with a row of real Chips above it for
// contrast.
const meta = {
  title: 'Primitives/Value chip',
  component: ValueChipDemo,
  args: { withFilters: true },
  argTypes: { withFilters: { control: 'boolean' } },
} satisfies Meta<typeof ValueChipDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// Chips that hold a state, above chips that hold a value. Same pill, and only
// the top row is ever `aria-pressed` (§8.23.6, §8.27.6).
export const AlongsideFilterChips: Story = { args: { withFilters: true } };

export const OnItsOwn: Story = { args: { withFilters: false } };
