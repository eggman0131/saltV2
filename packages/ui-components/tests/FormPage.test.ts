// spec: ui-spec-v13.md §1.7 v0.13
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import FormPage from '../src/templates/FormPage/FormPage.svelte';

afterEach(() => cleanup());

function snippet(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('FormPage (ui-spec-v13 §1)', () => {
  describe('the form is real (§1.3)', () => {
    it('renders a <form> with the title as the page h1', () => {
      const { container } = render(FormPage, { props: { title: 'New list' } });
      expect(container.querySelector('form')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New list');
    });

    it('submits through a real type="submit" button, so Enter-in-a-field works', () => {
      render(FormPage, { props: { title: 'New list' } });
      expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
    });

    it('sets novalidate, so the browser raises no constraint bubbles', () => {
      const { container } = render(FormPage, { props: { title: 'New list' } });
      expect(container.querySelector('form')).toHaveAttribute('novalidate');
    });

    it('calls onSubmit and prevents the default navigation', async () => {
      const onSubmit = vi.fn();
      const { container } = render(FormPage, { props: { title: 'New list', onSubmit } });
      const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
      container.querySelector('form')!.dispatchEvent(event);
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('submitting (§1.4)', () => {
    it('canSubmit: false disables the submit button', () => {
      render(FormPage, { props: { title: 'New list', canSubmit: false } });
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('isSubmitting disables cancel and puts submit in its loading state', () => {
      render(FormPage, { props: { title: 'New list', isSubmitting: true, onCancel: vi.fn() } });
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      // v0.2 §4.3 — loading disables interaction without terminal semantics.
      expect(screen.getByRole('button', { name: /Save/ })).toHaveAttribute('aria-busy', 'true');
    });

    it('does not disable the fields', () => {
      render(FormPage, {
        props: { title: 'New list', isSubmitting: true, children: snippet('a field') },
      });
      expect(screen.getByText('a field')).toBeInTheDocument();
    });
  });

  describe('the footer (§1.5)', () => {
    it('renders no cancel button when onCancel is omitted', () => {
      render(FormPage, { props: { title: 'New list' } });
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('calls onCancel when cancel is clicked', async () => {
      const onCancel = vi.fn();
      render(FormPage, { props: { title: 'New list', onCancel } });
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('honours submitLabel and cancelLabel', () => {
      render(FormPage, {
        props: {
          title: 'New list',
          submitLabel: 'Create',
          cancelLabel: 'Discard',
          onCancel: vi.fn(),
        },
      });
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    });

    it('the footer snippet replaces the whole pair, it does not extend it', () => {
      render(FormPage, {
        props: { title: 'New list', onCancel: vi.fn(), footer: snippet('custom footer') },
      });
      expect(screen.getByText('custom footer')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('renders the description and the children', () => {
      render(FormPage, {
        props: { title: 'New list', description: 'Name it.', children: snippet('a field') },
      });
      expect(screen.getByText('Name it.')).toBeInTheDocument();
      expect(screen.getByText('a field')).toBeInTheDocument();
    });

    it('merges the class prop', () => {
      const { container } = render(FormPage, { props: { title: 'New list', class: 'extra' } });
      expect(container.querySelector('form')).toHaveClass('extra');
    });
  });
});
