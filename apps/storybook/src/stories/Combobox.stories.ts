import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (ComboboxDemo.svelte): Combobox
// is a context-driven compound with a render-prop ComboboxContent snippet that a
// single `component` + `args` cannot express. The wrapper forces `portal={false}`
// so the dropdown renders inline. It imports ONLY @salt/ui-components (Rule 7);
// see Button.stories.ts for why Svelte CSF is not used under Vite 8.
//
// The filtered results / "Create …" row are internal-filter-state driven (only
// reachable by typing, and no @storybook/test is installed for a `play` fn), so
// the wrapper renders those states statically — see ComboboxDemo.svelte.
import ComboboxDemo from './_wrappers/ComboboxDemo.svelte';

const meta = {
  title: 'Primitives/Combobox',
  component: ComboboxDemo,
  args: {
    open: false,
    allowCustom: false,
    empty: false,
    placeholder: 'Search ingredients…',
  },
  argTypes: {
    open: { control: 'boolean' },
    allowCustom: { control: 'boolean' },
    empty: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
} satisfies Meta<typeof ComboboxDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Closed searchable field: just the input + toggle.
export const Searchable: Story = { args: { open: false } };

// Open: the listbox renders inline with all items.
export const Open: Story = { args: { open: true } };

// allowCustom: an inline "Create …" row lets the user add a value not in the list.
export const AllowCustom: Story = { args: { open: true, allowCustom: true } };

// No matching items: the ComboboxEmpty fallback is shown.
export const Empty: Story = { args: { open: true, empty: true } };
