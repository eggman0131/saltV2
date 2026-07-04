<script lang="ts">
  import {
    TextField,
    TextArea,
    Checkbox,
    Switch,
    RadioGroup,
    RadioGroupItem,
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    Slider,
    SliderTrack,
    SliderRange,
    SliderThumb,
  } from '@salt/ui-components';

  let textValue = $state('');
  let textareaValue = $state('');
  let checked = $state(false);
  let switchOn = $state(false);
  let radioValue = $state('');
  let selectValue = $state('');
  let sliderValue = $state<number>(50);
</script>

<section id="form">
  <h2 class="section-title">Form inputs</h2>

  <div class="subsection">
    <h3 class="subsection-title">TextField</h3>
    <div class="flex flex-col gap-4 max-w-sm">
      <TextField label="Default" placeholder="Enter value…" bind:value={textValue} />
      <TextField
        label="With description"
        description="Helper text below the input."
        placeholder="Enter value…"
      />
      <TextField label="Error state" error="This field is required." placeholder="Enter value…" />
      <TextField label="Disabled" disabled placeholder="Disabled input" />
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">TextArea</h3>
    <div class="flex flex-col gap-4 max-w-sm">
      <TextArea label="Default" placeholder="Write something…" bind:value={textareaValue} />
      <TextArea label="Auto-resize" autoresize placeholder="Grows as you type…" />
      <TextArea label="With error" error="Too short." placeholder="Write something…" />
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Checkbox</h3>
    <div class="flex flex-col gap-3">
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked={true} />
      <Checkbox label="Indeterminate" defaultChecked="indeterminate" />
      <Checkbox label="Disabled" disabled />
      <Checkbox label="With description" description="Optional helper text." />
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Switch</h3>
    <div class="flex flex-col gap-3">
      <Switch label="Notifications" bind:checked={switchOn} />
      <Switch label="Publish to family" defaultChecked={true} />
      <Switch label="Disabled" disabled />
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">RadioGroup</h3>
    <div class="flex flex-col gap-6">
      <RadioGroup label="Vertical (default)" bind:value={radioValue}>
        <RadioGroupItem value="apple" label="Apple" />
        <RadioGroupItem value="banana" label="Banana" />
        <RadioGroupItem value="cherry" label="Cherry" />
      </RadioGroup>
      <RadioGroup label="Horizontal" orientation="horizontal">
        <RadioGroupItem value="yes" label="Yes" />
        <RadioGroupItem value="no" label="No" />
        <RadioGroupItem value="maybe" label="Maybe" />
      </RadioGroup>
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Select</h3>
    <div class="max-w-xs">
      <Select bind:value={selectValue} placeholder="Pick a colour…">
        <SelectTrigger />
        <SelectContent>
          <SelectItem value="red" label="Red" />
          <SelectItem value="green" label="Green" />
          <SelectItem value="blue" label="Blue" />
          <SelectItem value="yellow" label="Yellow" />
        </SelectContent>
      </Select>
      {#if selectValue}
        <p class="mt-2 text-sm text-muted-foreground">Selected: {selectValue}</p>
      {/if}
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Slider</h3>
    <div class="max-w-sm flex flex-col gap-6">
      <div>
        <p class="text-sm font-medium mb-3">Single value: {sliderValue}</p>
        <Slider bind:value={sliderValue} min={0} max={100} step={1}>
          <SliderTrack>
            <SliderRange />
          </SliderTrack>
          <SliderThumb />
        </Slider>
      </div>
      <div>
        <p class="text-sm font-medium mb-3">Disabled</p>
        <Slider defaultValue={30} disabled min={0} max={100}>
          <SliderTrack>
            <SliderRange />
          </SliderTrack>
          <SliderThumb />
        </Slider>
      </div>
    </div>
  </div>
</section>
