// spec: SPEC.md §6 v0.2.3
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import TextField from '../src/primitives/TextField/TextField.svelte';

afterEach(() => cleanup());

describe('TextField', () => {
  describe('renders with minimum required props', () => {
    it('renders a labeled input', () => {
      render(TextField, { props: { label: 'Email' } });
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    it('renders a visible label', () => {
      render(TextField, { props: { label: 'Email' } });
      expect(screen.getByText('Email')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('applies size class to frame', () => {
      const { container } = render(TextField, { props: { label: 'x', size: 'lg' } });
      expect(container.querySelector('.salt-input--lg')).toBeInTheDocument();
    });

    it('applies error border when error is set', () => {
      const { container } = render(TextField, {
        props: { label: 'x', error: 'Required' },
      });
      expect(container.querySelector('.salt-input--error')).toBeInTheDocument();
    });

    it('applies disabled opacity when disabled', () => {
      const { container } = render(TextField, { props: { label: 'x', disabled: true } });
      expect(container.querySelector('.salt-input--disabled')).toBeInTheDocument();
    });

    it('merges class prop onto outer wrapper', () => {
      const { container } = render(TextField, {
        props: { label: 'x', class: 'custom-class' },
      });
      expect(container.firstElementChild).toHaveClass('custom-class');
    });

    it('renders description text', () => {
      render(TextField, { props: { label: 'x', description: 'Helper text' } });
      expect(screen.getByText('Helper text')).toBeInTheDocument();
    });

    it('renders error text', () => {
      render(TextField, { props: { label: 'x', error: 'Invalid email' } });
      expect(screen.getByText('Invalid email')).toBeInTheDocument();
    });

    it('error element has role="alert"', () => {
      render(TextField, { props: { label: 'x', error: 'Invalid' } });
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('focus ring is on frame, not on raw input', () => {
      const { container } = render(TextField, { props: { label: 'x' } });
      const frame = container.querySelector('.salt-focus-ring-within');
      expect(frame).toBeInTheDocument();
      expect(frame?.tagName).not.toBe('INPUT');
    });

    it('sets type attribute', () => {
      render(TextField, { props: { label: 'x', type: 'email' } });
      expect(screen.getByLabelText('x')).toHaveAttribute('type', 'email');
    });

    it('sets placeholder', () => {
      render(TextField, { props: { label: 'x', placeholder: 'Enter value' } });
      expect(screen.getByPlaceholderText('Enter value')).toBeInTheDocument();
    });
  });

  describe('events contract', () => {
    it('calls onValueChange on input', async () => {
      const onValueChange = vi.fn();
      render(TextField, { props: { label: 'x', onValueChange } });
      await userEvent.type(screen.getByLabelText('x'), 'hello');
      expect(onValueChange).toHaveBeenCalledWith('hello');
    });

    it('passes onfocus through', async () => {
      const onfocus = vi.fn();
      render(TextField, { props: { label: 'x', onfocus } });
      await userEvent.click(screen.getByLabelText('x'));
      expect(onfocus).toHaveBeenCalled();
    });

    it('passes onblur through', async () => {
      const onblur = vi.fn();
      render(TextField, { props: { label: 'x', onblur } });
      screen.getByLabelText('x').focus();
      await userEvent.tab();
      expect(onblur).toHaveBeenCalled();
    });
  });

  describe('keyboard interaction', () => {
    it('receives focus via Tab', async () => {
      render(TextField, { props: { label: 'x' } });
      await userEvent.tab();
      expect(screen.getByLabelText('x')).toHaveFocus();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(TextField, { props: { label: 'Email address' } });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('sets aria-required when required', () => {
      render(TextField, { props: { label: 'x', required: true } });
      expect(screen.getByLabelText('x')).toHaveAttribute('aria-required', 'true');
    });

    it('sets native required when required', () => {
      render(TextField, { props: { label: 'x', required: true } });
      expect(screen.getByLabelText('x')).toBeRequired();
    });

    it('sets aria-invalid when error is present', () => {
      render(TextField, { props: { label: 'x', error: 'Invalid' } });
      expect(screen.getByLabelText('x')).toHaveAttribute('aria-invalid', 'true');
    });

    it('error id is prepended to aria-describedby', () => {
      render(TextField, {
        props: { label: 'x', error: 'Err', description: 'Desc' },
      });
      const input = screen.getByLabelText('x');
      const describedBy = input.getAttribute('aria-describedby') ?? '';
      const ids = describedBy.split(' ');
      const errorEl = screen.getByRole('alert');
      const descEl = screen.getByText('Desc');
      expect(ids[0]).toBe(errorEl.id);
      expect(ids[1]).toBe(descEl.id);
    });

    it('description referenced via aria-describedby', () => {
      render(TextField, { props: { label: 'x', description: 'Helper' } });
      const input = screen.getByLabelText('x');
      const descEl = screen.getByText('Helper');
      expect(input.getAttribute('aria-describedby')).toContain(descEl.id);
    });
  });

  describe('controlled vs uncontrolled', () => {
    it('uses defaultValue when uncontrolled', () => {
      render(TextField, { props: { label: 'x', defaultValue: 'initial' } });
      expect(screen.getByLabelText('x')).toHaveValue('initial');
    });

    it('reflects provided value', () => {
      render(TextField, { props: { label: 'x', value: 'controlled' } });
      expect(screen.getByLabelText('x')).toHaveValue('controlled');
    });

    it('fires onValueChange and reflects new value on input', async () => {
      const onValueChange = vi.fn();
      render(TextField, { props: { label: 'x', onValueChange } });
      await userEvent.type(screen.getByLabelText('x'), 'a');
      expect(onValueChange).toHaveBeenCalledWith('a');
    });
  });
});
