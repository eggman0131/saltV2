<script lang="ts">
  import {
    Combobox,
    ComboboxField,
    ComboboxInput,
    ComboboxTrigger,
    ComboboxContent,
    ComboboxItem,
    ComboboxEmpty,
  } from '@salt/ui-components';

  const fruits = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'blueberry', label: 'Blueberry' },
    { value: 'cherry', label: 'Cherry' },
    { value: 'grape', label: 'Grape' },
    { value: 'mango', label: 'Mango' },
    { value: 'orange', label: 'Orange' },
    { value: 'peach', label: 'Peach' },
  ];

  let selected = $state('');
</script>

<section id="combobox">
  <h2 class="section-title">Combobox</h2>

  <div class="subsection">
    <h3 class="subsection-title">Searchable select</h3>
    <div class="max-w-xs">
      <Combobox items={fruits} bind:value={selected} placeholder="Search fruit…">
        <ComboboxField>
          <ComboboxInput />
          <ComboboxTrigger />
        </ComboboxField>
        <ComboboxContent>
          {#snippet children({ filteredItems })}
            {#each filteredItems as item, i}
              <ComboboxItem {item} index={i} />
            {/each}
            <ComboboxEmpty>No results found.</ComboboxEmpty>
          {/snippet}
        </ComboboxContent>
      </Combobox>
      {#if selected}
        <p class="mt-2 text-sm text-muted-foreground">Selected: {selected}</p>
      {/if}
    </div>
  </div>

  <div class="subsection">
    <h3 class="subsection-title">Allow custom values</h3>
    <div class="max-w-xs">
      <Combobox
        items={fruits}
        allowCustom
        placeholder="Type or pick a fruit…"
        onCreate={(v) => console.log('created:', v)}
      >
        <ComboboxField>
          <ComboboxInput />
          <ComboboxTrigger />
        </ComboboxField>
        <ComboboxContent>
          {#snippet children({ filteredItems, showCreate })}
            {#each filteredItems as item, i}
              <ComboboxItem {item} index={i} />
            {/each}
            {#if !showCreate}<ComboboxEmpty>No results.</ComboboxEmpty>{/if}
          {/snippet}
        </ComboboxContent>
      </Combobox>
    </div>
  </div>
</section>
