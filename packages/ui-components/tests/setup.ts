import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import '@testing-library/jest-dom/vitest';
expect.extend(axeMatchers);
