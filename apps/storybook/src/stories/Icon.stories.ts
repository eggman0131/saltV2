import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a showcase wrapper (IconDemo.svelte) so a single file
// can offer both the single-icon control (name/size) and the Gallery grid. The
// wrapper imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts for
// why Svelte CSF is not used under Vite 8.
import IconDemo from './_wrappers/IconDemo.svelte';

// A representative subset of Lucide names for the single-icon `name` control.
// (Icon.name is the full `keyof typeof icons` union — Lucide renamed Home →
// House, which the wrapper's typed gallery list enforces at check time.)
const NAMES = [
  'Bell',
  'Check',
  'ChevronDown',
  'CircleAlert',
  'Download',
  'Heart',
  'House',
  'Info',
  'LogOut',
  'Mail',
  'Menu',
  'Plus',
  'Search',
  'Settings',
  'Star',
  'Trash',
  'User',
  'X',
] as const;

const meta = {
  title: 'Primitives/Icon',
  component: IconDemo,
  args: {
    name: 'Star',
    size: 24,
    gallery: false,
  },
  argTypes: {
    name: { control: 'select', options: NAMES },
    size: { control: { type: 'number', min: 12, max: 96, step: 2 } },
    gallery: { control: 'boolean' },
  },
} satisfies Meta<typeof IconDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: pick any name and size from the Controls panel.
export const Playground: Story = {};

export const Small: Story = { args: { name: 'Search', size: 16 } };
export const Large: Story = { args: { name: 'Heart', size: 48 } };

// A grid of ~18 representative icons.
export const Gallery: Story = { args: { gallery: true } };
