import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { createRawSnippet } from 'svelte';
// Rule 7: primitives are consumed ONLY through @salt/ui-components, never
// bits-ui / melt-ui / shadcn-svelte directly.
import { Button } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — NOT Svelte CSF (.stories.svelte). The
// @storybook/addon-svelte-csf compiler is not yet Vite-8/Rolldown compatible
// (see apps/storybook/.storybook/main.ts + the Phase-1 report). CSF3 renders the
// real component via @storybook/svelte and needs no Svelte-CSF compiler.
//
// Button's label is a Svelte `children` snippet; createRawSnippet (Svelte 5)
// lets us build that snippet from a plain .ts story.
const label = (text: string) => createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

// Icon-only content for the `size: 'icon'` story. createRawSnippet returns an
// HTML string (same mechanism as label above), so a plain .ts story can render
// an icon without mounting a Svelte icon component. A single <svg> root keeps it
// a valid raw snippet.
const plusIcon = createRawSnippet(() => ({
  render: () =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
}));

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: {
    variant: 'solid',
    size: 'md',
    disabled: false,
    loading: false,
    fullWidth: false,
    children: label('Button'),
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['solid', 'outline', 'ghost', 'link', 'destructive'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    // The label snippet is not a user-facing control.
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives real Button props.
export const Playground: Story = {};

export const Solid: Story = { args: { variant: 'solid', children: label('Solid') } };
export const Outline: Story = { args: { variant: 'outline', children: label('Outline') } };
export const Ghost: Story = { args: { variant: 'ghost', children: label('Ghost') } };
export const Destructive: Story = {
  args: { variant: 'destructive', children: label('Destructive') },
};

export const Loading: Story = { args: { loading: true, children: label('Loading') } };
export const Disabled: Story = { args: { disabled: true, children: label('Disabled') } };

// Link variant (salt-button--link): renders as inline, underlined text.
export const Link: Story = { args: { variant: 'link', children: label('Link') } };

// Size scale beyond the default md. Large (salt-button--lg) and icon-only
// (salt-button--icon, square 36px) were previously never snapshotted.
export const Large: Story = { args: { size: 'lg', children: label('Large') } };
export const Icon: Story = { args: { size: 'icon', children: plusIcon } };

// Full-width (salt-button--full): stretches to the container width.
export const FullWidth: Story = { args: { fullWidth: true, children: label('Full width') } };

// ── Pressed state (§8.1) ────────────────────────────────────────────────────
// The press is two treatments at once: a `scale(0.94)` and a deepened fill,
// both keyed off `.salt-button:active, .salt-button[data-pressed]` in salt.css.
//
// `:active` is not reachable from a story — no static render and no Chromatic
// snapshot can hold a pointer down — so these stories force the OTHER half of
// that selector pair. `data-pressed` is the attribute Button.svelte sets while
// its JS press floor (PRESS_FLOOR_MS) holds a too-quick tap on; the component
// spreads `{...rest}` onto the <button> AFTER its own `data-pressed`, so an arg
// wins and the button renders permanently pressed. That makes this the only
// documentation surface for the pressed look — and the only one Chromatic can
// diff, since the real press cannot be captured.
//
// One per variant: the transform is shared, but each variant deepens its own
// fill differently (see the pressed-fill block in salt.css), so a single story
// would document one fifth of the treatment.
const pressed = { 'data-pressed': '' } as const;

export const Pressed: Story = {
  args: { ...pressed, variant: 'solid', children: label('Pressed solid') },
};
export const PressedOutline: Story = {
  args: { ...pressed, variant: 'outline', children: label('Pressed outline') },
};
export const PressedGhost: Story = {
  args: { ...pressed, variant: 'ghost', children: label('Pressed ghost') },
};
export const PressedDestructive: Story = {
  args: { ...pressed, variant: 'destructive', children: label('Pressed destructive') },
};
export const PressedLink: Story = {
  args: { ...pressed, variant: 'link', children: label('Pressed link') },
};
