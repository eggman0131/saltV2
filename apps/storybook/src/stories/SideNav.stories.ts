import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (SideNavDemo.svelte): SideNav needs
// a NavItem[] (icons are Lucide components) and an optional `footer` Snippet slot
// that a single `component` + `args` cannot express, and it is desktop-only
// (hidden lg:flex) so the wrapper forces it visible in isolation. The wrapper imports
// @salt/ui-components plus @lucide/svelte (the one sanctioned icon import, via
// _wrappers/navItems.ts); see Button.stories.ts for why Svelte CSF is not used under
// Vite 8.
import SideNavDemo from './_wrappers/SideNavDemo.svelte';

const meta = {
  title: 'Layout/SideNav',
  component: SideNavDemo,
  args: {
    currentPath: '/recipes',
    withFooter: false,
  },
  argTypes: {
    currentPath: { control: 'text' },
    withFooter: { control: 'boolean' },
  },
} satisfies Meta<typeof SideNavDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Nav list with the Recipes item active (highlighted via currentPath).
export const Default: Story = {};

// With a footer region (rendered below the nav list via the `footer` snippet).
export const WithFooter: Story = { args: { withFooter: true } };
