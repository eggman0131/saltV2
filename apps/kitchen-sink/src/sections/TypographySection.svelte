<script lang="ts">
  import { Heading, Text } from '@salt/ui-components';
</script>

<section id="typography">
  <h2 class="section-title">Typography</h2>

  <div class="subsection">
    <h3 class="subsection-title">Heading levels</h3>
    <div class="flex flex-col gap-3">
      <Heading level={1}>Heading level 1</Heading>
      <Heading level={2}>Heading level 2</Heading>
      <Heading level={3}>Heading level 3</Heading>
      <Heading level={4}>Heading level 4</Heading>
      <Heading level={5}>Heading level 5</Heading>
      <Heading level={6}>Heading level 6</Heading>
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Text</h3>
    <div class="flex flex-col gap-2">
      <Text size="lg">Large text — size lg</Text>
      <Text size="md">Medium text — size md (default)</Text>
      <Text size="sm">Small text — size sm</Text>
    </div>
  </div>
</section>
