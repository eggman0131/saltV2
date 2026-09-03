import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { EquipmentReferencePhoto } from '@salt/domain/schemas';
import { setNextCrop } from './fixtures/cropStub.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Only the cropper is swapped out of @salt/ui-components — the Dialog, Button
// and Icon primitives are the real ones, so the dialog is exercised as it ships,
// mirroring RecipeImportPhotoDialog's own test.
vi.mock('@salt/ui-components', async () => {
  const actual = await vi.importActual<typeof import('@salt/ui-components')>('@salt/ui-components');
  const stub = await import('./fixtures/StubImageCropper.svelte');
  return { ...actual, ImageCropper: stub.default };
});

vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));

import EquipmentPhotoDialog from '../src/components/EquipmentPhotoDialog.svelte';
import { addToast } from '../src/lib/toastStore.js';

const toastMock = vi.mocked(addToast);

// jsdom ships no object-URL implementation, and the capture flow's whole
// lifecycle is create-then-revoke — stub both and record the revokes, which is
// the only way to assert nothing leaks.
const revoked: string[] = [];
let objectUrlSeq = 0;

function openDialog(
  opts: { busy?: boolean; onDescribe?: (photo: EquipmentReferencePhoto) => void } = {},
) {
  const onDescribe = opts.onDescribe ?? vi.fn();
  render(EquipmentPhotoDialog, { props: { open: true, busy: opts.busy ?? false, onDescribe } });
  return onDescribe;
}

async function pickPhoto(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const input = screen.getByTestId('equipment-photo-input');
  await user.upload(input, new File(['bytes'], 'mixer.jpg', { type: 'image/jpeg' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  revoked.length = 0;
  objectUrlSeq = 0;
  setNextCrop('stub-cropped-base64');
  globalThis.URL.createObjectURL = vi.fn(() => `blob:photo-${++objectUrlSeq}`);
  globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

afterEach(cleanup);

describe('EquipmentPhotoDialog — capture', () => {
  it('opens on the capture prompt with nothing to describe yet', () => {
    openDialog();

    expect(screen.getByTestId('equipment-photo-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('equipment-photo-input')).toBeInTheDocument();
    expect(screen.getByTestId('equipment-photo-describe-btn')).toBeDisabled();
    expect(screen.getByTestId('equipment-photo-cancel')).toBeEnabled();
  });

  it('frames a photo free-aspect — the appliance keeps its own proportions', async () => {
    const user = userEvent.setup();
    openDialog();

    await pickPhoto(user);

    const cropper = await screen.findByTestId('stub-image-cropper');
    expect(cropper).toHaveAttribute('data-aspect', 'free');
    expect(cropper).toHaveAttribute('data-src', 'blob:photo-1');
    expect(screen.getByTestId('equipment-photo-describe-btn')).toBeEnabled();
  });
});

describe('EquipmentPhotoDialog — describe', () => {
  it('hands the cropped photo up as webp when Describe is pressed', async () => {
    const user = userEvent.setup();
    const onDescribe = openDialog();

    await pickPhoto(user);
    await user.click(screen.getByTestId('equipment-photo-describe-btn'));

    await waitFor(() =>
      expect(onDescribe).toHaveBeenCalledWith({
        base64: 'stub-cropped-base64',
        contentType: 'image/webp',
      }),
    );
  });

  it('treats a not-yet-ready crop as "try again", not as an error', async () => {
    const user = userEvent.setup();
    const onDescribe = openDialog();

    // getCroppedBase64() returns null while a free-mode source is still being
    // measured (ui-spec-v06 §1.4) — the shot must stay on screen.
    setNextCrop(null);
    await pickPhoto(user);
    await user.click(screen.getByTestId('equipment-photo-describe-btn'));

    expect(onDescribe).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('isn’t ready'), 'destructive');
    expect(screen.getByTestId('stub-image-cropper')).toBeInTheDocument();
  });
});

describe('EquipmentPhotoDialog — busy (the page describe call in flight)', () => {
  it('shows "Reading the photo…" and disables Cancel while busy', () => {
    openDialog({ busy: true });

    expect(screen.getByTestId('equipment-photo-describing')).toBeInTheDocument();
    expect(screen.getByTestId('equipment-photo-cancel')).toBeDisabled();
  });

  it('offers no file picker while busy — nothing to interrupt the call with', () => {
    openDialog({ busy: true });

    expect(screen.queryByTestId('equipment-photo-input')).toBeNull();
  });
});

describe('EquipmentPhotoDialog — cancel', () => {
  it('releases the object URL when dismissed', async () => {
    const user = userEvent.setup();
    openDialog();

    await pickPhoto(user);
    await user.click(screen.getByTestId('equipment-photo-cancel'));

    await waitFor(() => expect(revoked).toContain('blob:photo-1'));
  });

  it('dismisses on Escape too, releasing the object URL the same way', async () => {
    const user = userEvent.setup();
    openDialog();

    await pickPhoto(user);
    await user.keyboard('{Escape}');

    await waitFor(() => expect(revoked).toContain('blob:photo-1'));
  });
});
