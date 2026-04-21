import boundaries from 'eslint-plugin-boundaries';
import tsParser from '@typescript-eslint/parser';

// Element definitions used by eslint-plugin-boundaries.
// File-path patterns determine which element type a file belongs to.
// Package-name patterns allow matching workspace import specifiers directly.
const ELEMENTS = [
  {
    type: 'shared-types',
    pattern: ['packages/shared-types/**', '@salt/shared-types'],
  },
  {
    type: 'domain',
    pattern: ['packages/domain/**', '@salt/domain'],
  },
  {
    type: 'firebase-adapter',
    pattern: ['packages/adapters/firebase/**', '@salt/firebase-adapter'],
  },
  {
    type: 'ui-components',
    pattern: ['packages/ui-components/**', '@salt/ui-components'],
  },
  {
    type: 'testing-utils',
    pattern: ['packages/testing-utils/**', '@salt/testing-utils'],
  },
  {
    type: 'web-pwa',
    pattern: ['apps/web-pwa/**', '@salt/web-pwa'],
  },
  {
    type: 'cloud-functions',
    pattern: ['apps/cloud-functions/**', '@salt/cloud-functions'],
  },
];

// Import specifier patterns that must never appear in certain layers.
// Using no-restricted-imports so rules fire without module resolution.

const FIREBASE_PKGS = ['firebase', 'firebase/*', 'firebase-admin', 'firebase-admin/*'];
const SALT_APP_IMPORTS = [
  '@salt/web-pwa',
  '@salt/web-pwa/*',
  '@salt/cloud-functions',
  '@salt/cloud-functions/*',
];

function forbidGroup(pkgs, message) {
  return pkgs.map((g) => ({ group: [g], message }));
}

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.svelte-kit/**',
      '**/__boundary_tests__/**',
      '.boundary-tests/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
  },
  // eslint-plugin-boundaries: file-path-based import graph enforcement.
  // Catches violations when imports resolve to local files (relative paths, or
  // workspace symlinks). Second opinion after no-restricted-imports.
  {
    files: ['**/*.ts'],
    plugins: { boundaries },
    settings: { 'boundaries/elements': ELEMENTS },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'shared-types', allow: [] },
            { from: 'domain', allow: ['shared-types'] },
            { from: 'firebase-adapter', allow: ['domain', 'shared-types'] },
            { from: 'ui-components', allow: [] },
            { from: 'testing-utils', allow: ['shared-types', 'domain', 'firebase-adapter'] },
            {
              from: 'web-pwa',
              allow: ['shared-types', 'domain', 'firebase-adapter', 'ui-components'],
            },
            { from: 'cloud-functions', allow: ['shared-types', 'domain', 'firebase-adapter'] },
          ],
        },
      ],
    },
  },
  // no-restricted-imports: specifier-based rules that fire without module resolution.
  // Each element type gets ONE comprehensive block so there are no rule override conflicts.
  // Later config blocks for specific packages replace the earlier generic one for those files.

  // Generic default: packages and boundary-test fixtures must not import apps.
  {
    files: ['packages/**/*.ts', '.boundary-tests/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidGroup(
            SALT_APP_IMPORTS,
            'Packages must not import from apps. Apps are leaf nodes in the dependency graph.',
          ),
        },
      ],
    },
  },

  // @salt/domain — must not import firebase or anything outside shared-types.
  // This block comes AFTER the generic one and replaces it for domain files.
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(
              FIREBASE_PKGS,
              'Firebase SDK imports are only allowed in @salt/firebase-adapter. Use the repository port instead.',
            ),
            ...forbidGroup(
              [
                '@salt/firebase-adapter',
                '@salt/firebase-adapter/*',
                '@salt/ui-components',
                '@salt/ui-components/*',
                '@salt/testing-utils',
                '@salt/testing-utils/*',
                ...SALT_APP_IMPORTS,
              ],
              '@salt/domain may only import @salt/shared-types from the workspace.',
            ),
          ],
        },
      ],
    },
  },

  // @salt/shared-types — must not import any other @salt/* package.
  {
    files: ['packages/shared-types/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidGroup(
            [
              '@salt/domain',
              '@salt/domain/*',
              '@salt/firebase-adapter',
              '@salt/firebase-adapter/*',
              '@salt/ui-components',
              '@salt/ui-components/*',
              '@salt/testing-utils',
              '@salt/testing-utils/*',
              ...SALT_APP_IMPORTS,
            ],
            '@salt/shared-types must not import any other @salt/* package.',
          ),
        },
      ],
    },
  },

  // Boundary-test fixtures: apply the same restrictions as their target layer.
  {
    files: ['packages/domain/src/__boundary_tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(
              FIREBASE_PKGS,
              'Firebase SDK imports are only allowed in @salt/firebase-adapter. Use the repository port instead.',
            ),
            ...forbidGroup(SALT_APP_IMPORTS, 'Packages must not import from apps.'),
          ],
        },
      ],
    },
  },
  {
    files: ['packages/shared-types/src/__boundary_tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidGroup(
            [
              '@salt/domain',
              '@salt/domain/*',
              '@salt/firebase-adapter',
              '@salt/firebase-adapter/*',
              '@salt/ui-components',
              '@salt/ui-components/*',
              '@salt/testing-utils',
              '@salt/testing-utils/*',
              ...SALT_APP_IMPORTS,
            ],
            '@salt/shared-types must not import any other @salt/* package.',
          ),
        },
      ],
    },
  },
];
