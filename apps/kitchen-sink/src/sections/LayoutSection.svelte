<script lang="ts">
  import {
    Stack,
    Grid,
    Inline,
    Divider,
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
    Text,
  } from '@salt/ui-components';
</script>

<section id="layout">
  <h2 class="section-title">Layout</h2>

  <div class="subsection">
    <h3 class="subsection-title">Stack</h3>
    <Stack gap="4">
      <div class="demo-box">Item A</div>
      <div class="demo-box">Item B</div>
      <div class="demo-box">Item C</div>
    </Stack>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Grid (3 cols)</h3>
    <Grid cols={3} gap="4">
      <div class="demo-box">1</div>
      <div class="demo-box">2</div>
      <div class="demo-box">3</div>
      <div class="demo-box">4</div>
      <div class="demo-box">5</div>
      <div class="demo-box">6</div>
    </Grid>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Inline</h3>
    <Inline gap="2">
      <div class="demo-box">Alpha</div>
      <div class="demo-box">Beta</div>
      <div class="demo-box">Gamma</div>
    </Inline>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Divider</h3>
    <Stack gap="3">
      <Text>Above the line</Text>
      <Divider />
      <Text>Below the line</Text>
    </Stack>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Card</h3>
    <Card class="max-w-sm">
      <CardHeader>
        <CardTitle>Card title</CardTitle>
        <CardDescription>Supporting description text goes here.</CardDescription>
      </CardHeader>
      <CardContent>
        <Text>Main card body content.</Text>
      </CardContent>
      <CardFooter>
        <Text size="sm" muted>Footer area</Text>
      </CardFooter>
    </Card>
  </div>
</section>
