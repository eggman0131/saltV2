import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

// The component reads the install store; mock it so each test controls the
// detection outcome without touching navigator/matchMedia. vi.hoisted keeps the
// object defined before the hoisted vi.mock factory references it.
const mockInstall = vi.hoisted(() => ({
  isStandalone: false,
  isIosSafari: false,
  canPromptInstall: false,
  promptInstall: vi.fn(),
}));
vi.mock('../src/lib/install.svelte.js', () => ({ install: mockInstall }));

import AddToHomeScreen from '../src/components/AddToHomeScreen.svelte';

beforeEach(() => {
  cleanup();
  mockInstall.isStandalone = false;
  mockInstall.isIosSafari = false;
  mockInstall.canPromptInstall = false;
  mockInstall.promptInstall = vi.fn().mockResolvedValue('accepted');
});

describe('AddToHomeScreen (#545)', () => {
  it('renders nothing when the app already runs standalone', () => {
    mockInstall.isStandalone = true;
    mockInstall.isIosSafari = true; // standalone wins regardless
    render(AddToHomeScreen);
    expect(screen.queryByTestId('add-to-home-screen')).not.toBeInTheDocument();
  });

  it('shows the iOS Add-to-Home-Screen explainer on iOS Safari (not installed)', () => {
    mockInstall.isIosSafari = true;
    render(AddToHomeScreen);
    expect(screen.getByTestId('add-to-home-screen')).toBeInTheDocument();
    expect(screen.getByText('Add Salt to your Home Screen')).toBeInTheDocument();
    expect(screen.getByText('Tap the Share button')).toBeInTheDocument();
    // No native install button in the iOS branch.
    expect(screen.queryByTestId('add-to-home-screen-install')).not.toBeInTheDocument();
  });

  it('dismisses the explainer within the session', async () => {
    mockInstall.isIosSafari = true;
    render(AddToHomeScreen);
    expect(screen.getByTestId('add-to-home-screen')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('add-to-home-screen-dismiss'));
    expect(screen.queryByTestId('add-to-home-screen')).not.toBeInTheDocument();
  });

  it('shows a native Install button and fires the prompt on Android/desktop', async () => {
    mockInstall.canPromptInstall = true;
    render(AddToHomeScreen);
    const button = screen.getByTestId('add-to-home-screen-install');
    expect(button).toBeInTheDocument();
    // iOS explainer copy is absent on this branch.
    expect(screen.queryByText('Add Salt to your Home Screen')).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(mockInstall.promptInstall).toHaveBeenCalledOnce();
  });
});
