import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { longpress } from '../src/lib/longpress.svelte.js';

// The long-press action (issue #714) has exactly four obligations, and every one
// of them is about NOT firing as much as about firing:
//   - it fires on timer expiry while still held (not on release);
//   - a short press is a tap and must reach the handler underneath;
//   - travel past the slop is somebody else's gesture (the cook deck's fling),
//     so the hold is abandoned and nothing is added;
//   - having fired, it eats exactly one follow-on click, so the mise row does
//     not also toggle and the chip does not also expand.
// jsdom implements PointerEvent, which is all these need — the action never
// captures the pointer and never measures anything.

const HOLD_MS = 450;

function pointer(
  type: string,
  init: { pointerId?: number; clientX?: number; clientY?: number } = {},
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
}

function mount(onLongPress: () => void) {
  const node = document.createElement('button');
  document.body.append(node);
  const handle = longpress(node, { onLongPress });
  return { node, handle };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('longpress — firing', () => {
  it('fires once the hold elapses, with the pointer still down', () => {
    const onLongPress = vi.fn();
    const { node } = mount(onLongPress);

    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a short press, so a tap still reaches the handler underneath', () => {
    const onLongPress = vi.fn();
    const { node } = mount(onLongPress);
    const onClick = vi.fn();
    node.addEventListener('click', onClick);

    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(120);
    node.dispatchEvent(pointer('pointerup'));
    // Releasing must not fire it late, either — the timer is dropped, not run.
    vi.advanceTimersByTime(HOLD_MS);
    expect(onLongPress).not.toHaveBeenCalled();

    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire again on a second release of the same press', () => {
    const onLongPress = vi.fn();
    const { node } = mount(onLongPress);

    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS);
    node.dispatchEvent(pointer('pointerup'));
    vi.advanceTimersByTime(HOLD_MS * 2);

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});

describe('longpress — cancelling', () => {
  it('abandons the hold once the pointer travels past the slop', () => {
    const onLongPress = vi.fn();
    const { node } = mount(onLongPress);

    node.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
    vi.advanceTimersByTime(100);
    // A vertical fling on a step pill: the deck pages, this adds nothing.
    node.dispatchEvent(pointer('pointermove', { clientX: 100, clientY: 160 }));
    vi.advanceTimersByTime(HOLD_MS);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('tolerates the wobble of a finger resting on glass', () => {
    const onLongPress = vi.fn();
    const { node } = mount(onLongPress);

    node.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
    node.dispatchEvent(pointer('pointermove', { clientX: 103, clientY: 97 }));
    vi.advanceTimersByTime(HOLD_MS);

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('abandons the hold when the browser takes the gesture, or the pointer leaves', () => {
    for (const ending of ['pointercancel', 'pointerleave'] as const) {
      const onLongPress = vi.fn();
      const { node, handle } = mount(onLongPress);

      node.dispatchEvent(pointer('pointerdown'));
      vi.advanceTimersByTime(100);
      node.dispatchEvent(pointer(ending));
      vi.advanceTimersByTime(HOLD_MS);

      expect(onLongPress, ending).not.toHaveBeenCalled();
      handle.destroy();
    }
  });

  it('abandons the hold when a second pointer goes down', () => {
    const onLongPress = vi.fn();
    const { node } = mount(onLongPress);

    node.dispatchEvent(pointer('pointerdown', { pointerId: 1 }));
    vi.advanceTimersByTime(100);
    node.dispatchEvent(pointer('pointerdown', { pointerId: 2 }));
    vi.advanceTimersByTime(HOLD_MS);

    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe('longpress — swallowing the follow-on click', () => {
  it('eats exactly one click after firing, and lets the next genuine tap through', () => {
    const onLongPress = vi.fn();
    const { node } = mount(onLongPress);
    const onClick = vi.fn();
    node.addEventListener('click', onClick);

    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS);
    node.dispatchEvent(pointer('pointerup'));

    // The release's own click: swallowed, so `toggleIngredient`/`expandChip`
    // never runs for a press that was a hold.
    const swallowed = new MouseEvent('click', { bubbles: true, cancelable: true });
    node.dispatchEvent(swallowed);
    expect(onClick).not.toHaveBeenCalled();
    expect(swallowed.defaultPrevented).toBe(true);

    // The very next click is a real tap again — the eater is one-shot.
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // The regression that made cook mode tick the mise row it had just added: the
  // eater used to start its cleanup countdown at FIRE time, so any hold that ran
  // on past it leaked the release's click through. Holding on is the normal case,
  // not an edge one — the toast that confirms the add waits on a Firestore write,
  // so a cook keeps their finger down until they see something happen.
  it('still eats the click after a hold that runs long past the moment it fired', () => {
    const onLongPress = vi.fn();
    const { node } = mount(onLongPress);
    const onClick = vi.fn();
    node.addEventListener('click', onClick);

    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    // Two more seconds of holding — far beyond any cleanup window.
    vi.advanceTimersByTime(2_000);
    node.dispatchEvent(pointer('pointerup'));

    const swallowed = new MouseEvent('click', { bubbles: true, cancelable: true });
    node.dispatchEvent(swallowed);
    expect(onClick).not.toHaveBeenCalled();
    expect(swallowed.defaultPrevented).toBe(true);
  });

  it('stops eating clicks once the release has come and gone', () => {
    const onLongPress = vi.fn();
    const { node } = mount(onLongPress);
    const onClick = vi.fn();
    node.addEventListener('click', onClick);

    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS);
    node.dispatchEvent(pointer('pointerup'));
    // No click arrived (a hold that ended off the element, say). The eater must
    // clean itself up rather than lie in wait for a later tap.
    vi.advanceTimersByTime(1_000);

    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('longpress — lifecycle', () => {
  it('is inert while disabled, and live again once re-enabled', () => {
    const onLongPress = vi.fn();
    const node = document.createElement('button');
    document.body.append(node);
    const handle = longpress(node, { enabled: false, onLongPress });

    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS);
    expect(onLongPress).not.toHaveBeenCalled();

    handle.update({ enabled: true, onLongPress });
    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('drops a hold that is in flight when it is disabled mid-press', () => {
    const onLongPress = vi.fn();
    const { node, handle } = mount(onLongPress);

    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(100);
    handle.update({ enabled: false, onLongPress });
    vi.advanceTimersByTime(HOLD_MS);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('leaves no timer and no listener behind on destroy', () => {
    const onLongPress = vi.fn();
    const { node, handle } = mount(onLongPress);

    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(100);
    handle.destroy();
    vi.advanceTimersByTime(HOLD_MS);
    expect(onLongPress).not.toHaveBeenCalled();

    // And the node is genuinely detached from the action afterwards.
    node.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
