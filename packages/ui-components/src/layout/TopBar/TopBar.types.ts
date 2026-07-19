import type { Snippet } from 'svelte';

export interface TopBarProps {
  title?: string;
  actions?: Snippet | undefined;
  /**
   * Centred environment label (e.g. "Staging"), rendered dead-centre on the bar
   * independent of the title and actions. Omit in production to show no label.
   */
  envLabel?: string | undefined;
  /**
   * Tailwind classes overriding the bar surface (background / text / border
   * colour) for a non-prod environment. Omit to keep the default `bg-card`
   * surface. The colour vocabulary is the app's concern, so it is passed in
   * rather than mapped here — TopBar stays environment-agnostic.
   */
  envClass?: string | undefined;
  class?: string;
}
