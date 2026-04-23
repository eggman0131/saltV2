<!-- spec: SPEC.md §1.3 §3.3 §4.5 v0.3 -->
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
    RadioGroup,
    RadioGroupItem,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    Slider,
    SliderRange,
    SliderThumb,
    SliderTrack,
    Switch,
    TextField,
    Toast,
    ToastAction,
    ToastClose,
    ToastDescription,
    ToastProvider,
    ToastTitle,
    ToastViewport,
  } from '@salt/ui-components';

  let darkMode = $state(false);
  let dialogOpen = $state(false);
  let textValue = $state('');
  let checkboxChecked = $state(false);
  let switchChecked = $state(false);
  let progressValue = $state<number | undefined>(40);

  // v0.3 state
  let radioValue = $state('option1');
  let selectValue = $state<string | undefined>(undefined);
  let sliderValue = $state<number>(40);
  let sliderRangeValue = $state<[number, number]>([20, 70]);
  let sheetOpen = $state(false);
  let toastOpen = $state(false);
  let toastDestructiveOpen = $state(false);

  function toggleDark() {
    darkMode = !darkMode;
    document.documentElement.classList.toggle('dark', darkMode);
  }
</script>

<ToastProvider>
  <main class="min-h-screen bg-background text-foreground p-8 space-y-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Salt UI — Phase 15 Smoke Test (v0.3)</h1>
      <Button variant="outline" onclick={toggleDark}>
        {darkMode ? 'Light mode' : 'Dark mode'}
      </Button>
    </div>

    <!-- v0.2 primitives -->

    <!-- Buttons -->
    <Card>
      <CardHeader><CardTitle>Button</CardTitle></CardHeader>
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
      <CardHeader><CardTitle>TextField</CardTitle></CardHeader>
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
      <CardHeader><CardTitle>Checkbox &amp; Switch</CardTitle></CardHeader>
      <CardContent>
        <div class="space-y-4">
          <Checkbox bind:checked={checkboxChecked} label="Accept terms" />
          <Switch bind:checked={switchChecked} label="Notifications" />
        </div>
      </CardContent>
    </Card>

    <!-- Dialog -->
    <Card>
      <CardHeader><CardTitle>Dialog</CardTitle></CardHeader>
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
      <CardHeader><CardTitle>Progress</CardTitle></CardHeader>
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

    <!-- v0.3 primitives -->

    <!-- RadioGroup -->
    <Card>
      <CardHeader><CardTitle>RadioGroup (v0.3)</CardTitle></CardHeader>
      <CardContent>
        <RadioGroup bind:value={radioValue} label="Favourite fruit">
          <RadioGroupItem value="option1" label="Apple" />
          <RadioGroupItem value="option2" label="Banana" />
          <RadioGroupItem value="option3" label="Cherry" />
          <RadioGroupItem value="option4" label="Disabled" disabled />
        </RadioGroup>
        <p class="mt-2 text-sm text-muted-foreground">Selected: {radioValue}</p>
      </CardContent>
    </Card>

    <!-- Select -->
    <Card>
      <CardHeader><CardTitle>Select (v0.3)</CardTitle></CardHeader>
      <CardContent>
        <Select bind:value={selectValue} placeholder="Choose a colour…">
          <SelectTrigger />
          <SelectContent>
            <SelectItem value="red" label="Red" />
            <SelectItem value="green" label="Green" />
            <SelectItem value="blue" label="Blue" />
            <SelectItem value="yellow" label="Yellow" />
          </SelectContent>
        </Select>
        <p class="mt-2 text-sm text-muted-foreground">Selected: {selectValue ?? '—'}</p>
      </CardContent>
    </Card>

    <!-- Slider -->
    <Card>
      <CardHeader><CardTitle>Slider (v0.3)</CardTitle></CardHeader>
      <CardContent>
        <div class="space-y-6">
          <div>
            <p class="text-sm mb-2">Single: {sliderValue}</p>
            <Slider bind:value={sliderValue} min={0} max={100} step={1}>
              <SliderTrack>
                <SliderRange />
              </SliderTrack>
              <SliderThumb />
            </Slider>
          </div>
          <div>
            <p class="text-sm mb-2">Range: {sliderRangeValue[0]} – {sliderRangeValue[1]}</p>
            <Slider bind:value={sliderRangeValue} min={0} max={100} step={5}>
              <SliderTrack>
                <SliderRange />
              </SliderTrack>
              <SliderThumb />
              <SliderThumb />
            </Slider>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Sheet -->
    <Card>
      <CardHeader><CardTitle>Sheet (v0.3)</CardTitle></CardHeader>
      <CardContent>
        <Sheet bind:open={sheetOpen} side="right">
          <SheetTrigger>Open sheet</SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Sheet panel</SheetTitle>
              <SheetDescription>This is a side-mounted modal drawer.</SheetDescription>
            </SheetHeader>
            <div class="py-4">
              <TextField label="Name" placeholder="Enter your name" />
            </div>
            <SheetFooter>
              <SheetClose>Close</SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>

    <!-- Toast -->
    <Card>
      <CardHeader><CardTitle>Toast (v0.3)</CardTitle></CardHeader>
      <CardContent>
        <div class="flex gap-3">
          <Button onclick={() => (toastOpen = true)}>Show toast</Button>
          <Button variant="destructive" onclick={() => (toastDestructiveOpen = true)}
            >Show destructive toast</Button
          >
        </div>
      </CardContent>
    </Card>
  </main>

  <ToastViewport />

  <Toast bind:open={toastOpen} variant="default">
    <ToastTitle>Success</ToastTitle>
    <ToastDescription>Your changes have been saved.</ToastDescription>
    <ToastAction onclick={() => (toastOpen = false)}>Undo</ToastAction>
    <ToastClose />
  </Toast>

  <Toast bind:open={toastDestructiveOpen} variant="destructive">
    <ToastTitle>Error</ToastTitle>
    <ToastDescription>Something went wrong. Please try again.</ToastDescription>
    <ToastClose />
  </Toast>
</ToastProvider>
