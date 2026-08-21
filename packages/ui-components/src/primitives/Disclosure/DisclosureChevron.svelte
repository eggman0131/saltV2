<!-- spec: ui-spec-v09.md §8.26 v0.9 -->
<script lang="ts">
  import Icon from '../Icon/Icon.svelte';
  import type { DisclosureChevronProps } from './Disclosure.types';

  let { expanded, size = 14 }: DisclosureChevronProps = $props();
</script>

<!-- Decorative: the trigger's text carries the accessible name and the button's
     `aria-expanded` carries the state, so the glyph announces nothing. -->
<Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} {size} />
