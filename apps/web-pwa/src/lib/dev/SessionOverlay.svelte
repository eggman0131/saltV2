<script lang="ts">
  import { startSession, stopSession, isSessionActive, getSessionURL } from '$lib/observability';

  let name = $state('');
  let active = $state(isSessionActive());
  let copied = $state(false);

  function handleStart() {
    startSession(name.trim() || undefined);
    active = true;
  }

  function handleStop() {
    stopSession();
    active = false;
    name = '';
  }

  async function handleCopy() {
    const url = getSessionURL();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="session-overlay" class:recording={active}>
  <div class="session-overlay__header">
    <span class="session-overlay__dot" class:active></span>
    <span class="session-overlay__label">{active ? 'Recording' : 'Idle'}</span>
  </div>

  {#if !active}
    <input
      class="session-overlay__input"
      type="text"
      placeholder="Session name (optional)"
      bind:value={name}
    />
    <button class="session-overlay__btn session-overlay__btn--start" onclick={handleStart}>
      Start
    </button>
  {:else}
    <button class="session-overlay__btn session-overlay__btn--stop" onclick={handleStop}>
      Stop
    </button>
    <button class="session-overlay__btn session-overlay__btn--copy" onclick={handleCopy}>
      {copied ? 'Copied!' : 'Copy URL'}
    </button>
  {/if}
</div>

<style>
  .session-overlay {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: #1a1a1a;
    color: #f0f0f0;
    border: 1px solid #444;
    border-radius: 8px;
    font-size: 12px;
    font-family: monospace;
    min-width: 160px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    opacity: 0.85;
  }

  .session-overlay.recording {
    border-color: #e53e3e;
  }

  .session-overlay__header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: bold;
  }

  .session-overlay__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #555;
  }

  .session-overlay__dot.active {
    background: #e53e3e;
    animation: pulse 1.2s infinite;
  }

  .session-overlay__input {
    background: #2a2a2a;
    border: 1px solid #555;
    border-radius: 4px;
    color: #f0f0f0;
    padding: 4px 6px;
    font-size: 12px;
    font-family: monospace;
    width: 100%;
    box-sizing: border-box;
  }

  .session-overlay__input::placeholder {
    color: #888;
  }

  .session-overlay__btn {
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    font-family: monospace;
    cursor: pointer;
    font-weight: bold;
  }

  .session-overlay__btn--start {
    background: #276749;
    color: #fff;
  }

  .session-overlay__btn--stop {
    background: #9b2c2c;
    color: #fff;
  }

  .session-overlay__btn--copy {
    background: #2b4c7e;
    color: #fff;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
