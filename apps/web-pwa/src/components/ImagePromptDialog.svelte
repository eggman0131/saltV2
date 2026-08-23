<script lang="ts">
  import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Icon,
    Spinner,
    Text,
  } from '@salt/ui-components';
  import type { GetImagePromptResult, ImagePromptFamily } from '@salt/domain/schemas';
  import { getImagePrompt } from '../lib/imagePromptService.js';
  import { addToast } from '../lib/toastStore.js';

  // A read-only window onto the words that draw one picture (issue #892).
  //
  // Shared by every generated-image surface — canon items, product forms, kitchen
  // tools, equipment and recipe heroes — because the thing on screen is identical
  // in all five: a prompt, the model it goes to, the seed it is conditioned on,
  // and a way to take the lot elsewhere. It lives in components/ rather than
  // @salt/ui-components because it knows about families and services, which makes
  // it an app composite rather than a primitive (Rule 7).
  //
  // NOTHING HERE IS EDITABLE, deliberately. The house-style wording reaching the
  // client reverses a stated intent that it never would; what that intent was
  // protecting is that the style is not EDITABLE, and read-only preserves it
  // exactly.

  type Props = {
    open: boolean;
    family: ImagePromptFamily;
    id: string;
    /** What the picture is of — shown so a dialog opened from a list says which row. */
    subject: string;
    'data-testid'?: string;
  };

  let {
    open = $bindable(),
    family,
    id,
    subject,
    'data-testid': testid = 'image-prompt-dialog',
  }: Props = $props();

  let loading = $state(false);
  let result = $state<GetImagePromptResult | null>(null);
  let failed = $state(false);
  let copied = $state(false);

  // The fetch is keyed on the (family, id) actually open, and the response is
  // dropped if either moved while it was in flight — a list can re-open this on a
  // different row before the first answer lands.
  let requestKey = '';

  async function load(): Promise<void> {
    const key = `${family}:${id}`;
    requestKey = key;
    loading = true;
    failed = false;
    result = null;
    const outcome = await getImagePrompt(family, id);
    if (requestKey !== key) return;
    loading = false;
    if (outcome.kind === 'ok') result = outcome.value;
    else failed = true;
  }

  $effect(() => {
    if (open) void load();
  });

  async function handleCopy(): Promise<void> {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.prompt);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard access can be refused outright (an insecure context, a browser
      // permission). Say so rather than showing a silent no-op — the words are
      // still on screen and selectable.
      addToast('Could not copy — select the text and copy it by hand.', 'destructive');
    }
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid={testid}>
      <DialogHeader>
        <DialogTitle>The prompt behind this picture</DialogTitle>
        <DialogDescription>
          The words that draw {subject}. Read-only — this is what the app sends, not something to
          edit here.
        </DialogDescription>
      </DialogHeader>

      {#if loading}
        <div class="flex items-center gap-2 py-6" data-testid="{testid}-loading">
          <Spinner />
          <Text size="sm" muted>Fetching the prompt…</Text>
        </div>
      {:else if failed}
        <div data-testid="{testid}-error">
          <Text size="sm" muted>Could not fetch the prompt. Try again in a moment.</Text>
        </div>
      {:else if result}
        <div class="flex flex-col gap-2">
          <pre
            class="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-foreground"
            data-testid="{testid}-text">{result.prompt}</pre>
          <dl class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <div class="flex gap-1">
              <dt class="font-medium">Model</dt>
              <dd data-testid="{testid}-model">{result.model}</dd>
            </div>
            <div class="flex gap-1">
              <dt class="font-medium">Seed image</dt>
              <dd data-testid="{testid}-seed">
                {result.seedFile ?? 'none — this one is prompt-only'}
              </dd>
            </div>
          </dl>
          <Text size="sm" muted>
            This is the prompt as it stands today. Prompts live in code, so a picture drawn before
            the wording last changed was made with slightly different words. A one-off steer typed
            into Regenerate is not part of it.
          </Text>
        </div>
      {/if}

      <DialogFooter>
        <Button variant="outline" onclick={() => (open = false)}>Close</Button>
        <Button data-testid="{testid}-copy" onclick={handleCopy} disabled={!result}>
          {#snippet leading()}
            <Icon name={copied ? 'Check' : 'Copy'} size={16} />
          {/snippet}
          {copied ? 'Copied' : 'Copy prompt'}
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
