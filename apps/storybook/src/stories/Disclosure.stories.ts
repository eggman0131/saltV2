import type { Meta, StoryObj } from '@storybook/svelte-vite';
import DisclosureRowDemo from './_wrappers/DisclosureRowDemo.svelte';

// `DisclosureTrigger` and `DisclosureChevron` are only meaningful in the shape
// they exist for — a row whose label column opens to reveal detail beneath it —
// so the story is that row, not the two pieces in isolation.
const meta = {
  title: 'Primitives/Disclosure',
  component: DisclosureRowDemo,
  args: { startExpanded: false },
  argTypes: { startExpanded: { control: 'boolean' } },
} satisfies Meta<typeof DisclosureRowDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Collapsed: Story = { args: { startExpanded: false } };
export const Expanded: Story = { args: { startExpanded: true } };
