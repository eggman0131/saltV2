<!-- spec: SPEC.md §1.3 §3.3 §4.5 v0.2.3 -->
<script lang="ts">
  import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    Progress,
    Switch,
    TextField,
  } from '@salt/ui-components';

  let darkMode = $state(false);
  let dialogOpen = $state(false);
  let textValue = $state('');
  let checkboxChecked = $state(false);
  let switchChecked = $state(false);
  let progressValue = $state<number | undefined>(40);

  function toggleDark() {
    darkMode = !darkMode;
    document.documentElement.classList.toggle('dark', darkMode);
  }
</script>

<main class="min-h-screen bg-background text-foreground p-8 space-y-8">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Salt UI — Phase 8 Smoke Test</h1>
    <Button variant="outline" onclick={toggleDark}>
      {darkMode ? 'Light mode' : 'Dark mode'}
    </Button>
  </div>

  <!-- Buttons -->
  <Card>
    <CardHeader>
      <CardTitle>Button</CardTitle>
    </CardHeader>
    <CardContent>
      <div class="flex flex-wrap gap-3">
        <Button variant="solid">Solid</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
        <Button disabled>Disabled</Button>
        <Button loading>Loading</Button>
      </div>
    </CardContent>
  </Card>

  <!-- TextField -->
  <Card>
    <CardHeader>
      <CardTitle>TextField</CardTitle>
    </CardHeader>
    <CardContent>
      <TextField
        bind:value={textValue}
        label="Name"
        placeholder="Enter your name"
        description="Used for your profile"
      />
    </CardContent>
  </Card>

  <!-- Checkbox + Switch -->
  <Card>
    <CardHeader>
      <CardTitle>Checkbox &amp; Switch</CardTitle>
    </CardHeader>
    <CardContent>
      <div class="space-y-4">
        <Checkbox bind:checked={checkboxChecked} label="Accept terms" />
        <Switch bind:checked={switchChecked} label="Notifications" />
      </div>
    </CardContent>
  </Card>

  <!-- Dialog -->
  <Card>
    <CardHeader>
      <CardTitle>Dialog</CardTitle>
    </CardHeader>
    <CardContent>
      <Dialog bind:open={dialogOpen}>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm action</DialogTitle>
            <DialogDescription>This is a demo dialog from the smoke test.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
            <Button onclick={() => (dialogOpen = false)}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>

  <!-- Progress -->
  <Card>
    <CardHeader>
      <CardTitle>Progress</CardTitle>
    </CardHeader>
    <CardContent>
      <div class="space-y-4">
        <Progress value={progressValue} ariaLabel="Demo progress" />
        <Progress ariaLabel="Indeterminate progress" />
        <div class="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onclick={() => (progressValue = Math.max(0, (progressValue ?? 0) - 10))}>-10</Button
          >
          <Button
            size="sm"
            variant="outline"
            onclick={() => (progressValue = Math.min(100, (progressValue ?? 0) + 10))}>+10</Button
          >
          <Button size="sm" variant="ghost" onclick={() => (progressValue = undefined)}
            >Indeterminate</Button
          >
        </div>
      </div>
    </CardContent>
  </Card>
</main>
