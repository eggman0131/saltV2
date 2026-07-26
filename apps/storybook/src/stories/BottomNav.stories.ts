import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (BottomNavDemo.svelte): BottomNav
// needs a NavItem[] (icons are Lucide components) and renders badge counts that a
// single `component` + `args` cannot express, and it is mobile-only (fixed lg:hidden)
// so the wrapper un-pins it and forces it visible. The wrapper imports
// @salt/ui-components plus @lucide/svelte (the one sanctioned icon import, via
// _wrappers/navItems.ts); see Button.stories.ts for why Svelte CSF is not used under
// Vite 8.
import BottomNavDemo from './_wrappers/BottomNavDemo.svelte';

const meta = {
  title: 'Layout/BottomNav',
  component: BottomNavDemo,
  args: {
    currentPath: '/',
    withBadge: false,
    withOverflow: false,
  },
  argTypes: {
    currentPath: { control: 'text' },
    withBadge: { control: 'boolean' },
    withOverflow: { control: 'boolean' },
  },
} satisfies Meta<typeof BottomNavDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Four-item bottom bar with the Home item active — the active tab carries the
// filled `accent` indicator pill behind its icon.
export const Default: Story = {};

// A badge count on the Shopping item.
export const WithBadge: Story = { args: { withBadge: true } };

// Four primary tabs plus a trailing "More" tab that opens the rest in a bottom sheet.
export const WithOverflow: Story = { args: { withOverflow: true } };

// The route lives behind the More tab: it takes the indicator pill (nothing else in
// the bar would look selected) and sums the folded-away badges onto itself.
export const OverflowActive: Story = {
  args: { withOverflow: true, withBadge: true, currentPath: '/settings' },
};
