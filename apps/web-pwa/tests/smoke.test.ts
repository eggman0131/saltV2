// spec: SPEC.md §1.3 v0.2.3
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import App from '../src/App.svelte';

afterEach(() => cleanup());

describe('@salt/web-pwa smoke', () => {
  it('mounts App with no axe violations', async () => {
    const { container } = render(App);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
