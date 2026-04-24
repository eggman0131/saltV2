<script lang="ts">
  import { Button, Icon } from '@salt/ui-components';
</script>

<section id="button">
  <h2 class="section-title">Button</h2>

  <div class="subsection">
    <h3 class="subsection-title">Variants</h3>
    <div class="flex flex-wrap gap-3">
      <Button variant="solid">Solid</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Sizes</h3>
    <div class="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" ariaLabel="Settings">
        {#snippet children()}<Icon name="Settings" size={16} />{/snippet}
      </Button>
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">States</h3>
    <div class="flex flex-wrap gap-3">
      <Button>Default</Button>
      <Button disabled>Disabled</Button>
      <Button loading>Loading</Button>
      <Button fullWidth>Full width</Button>
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">With icons</h3>
    <div class="flex flex-wrap gap-3">
      <Button>
        {#snippet leading()}<Icon name="Plus" size={16} />{/snippet}
        {#snippet children()}Add item{/snippet}
      </Button>
      <Button variant="outline">
        {#snippet children()}Download{/snippet}
        {#snippet trailing()}<Icon name="Download" size={16} />{/snippet}
      </Button>
    </div>
  </div>
</section>
