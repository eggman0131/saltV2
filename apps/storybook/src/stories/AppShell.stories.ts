import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (AppShellDemo.svelte): AppShell is
// the full app frame and needs a NavItem[] (icons are Lucide components), snippet
// slots, and page content that a single `component` + `args` cannot express. The
// wrapper imports @salt/ui-components plus @lucide/svelte (the one sanctioned icon
// import, via _wrappers/navItems.ts); see Button.stories.ts for why Svelte CSF is
// not used under Vite 8.
import AppShellDemo from './_wrappers/AppShellDemo.svelte';

const meta = {
  title: 'Layout/AppShell',
  component: AppShellDemo,
  args: {
    title: 'Salt',
    currentPath: '/recipes',
    navCollapsed: false,
  },
  argTypes: {
    title: { control: 'text' },
    currentPath: { control: 'text' },
    navCollapsed: { control: 'boolean' },
  },
} satisfies Meta<typeof AppShellDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Full frame: top bar + side nav (desktop) + page content, Recipes active.
export const Default: Story = {};

// The nav collapsed (ui-spec-v15 §1): the SideNav is NOT RENDERED — not hidden,
// not covered — and the page takes its 256px. The top bar's leading control is
// the only way back, which is why it lives there and not in the nav it hides.
// The control itself is `hidden lg:inline-flex`, so it shows only once the
// preview frame is at least `lg` wide.
export const NavCollapsed: Story = {
  args: { navCollapsed: true },
};
