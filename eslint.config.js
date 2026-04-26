import boundaries from 'eslint-plugin-boundaries';
import tsParser from '@typescript-eslint/parser';

// Element definitions used by eslint-plugin-boundaries.
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
    type: 'local-store',
    pattern: ['packages/adapters/local-store/**', '@salt/local-store'],
  },
  {
    type: 'firebase-sync',
    pattern: ['packages/adapters/firebase-sync/**', '@salt/firebase-sync'],
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
const FIREBASE_PKGS = ['firebase', 'firebase/*', 'firebase-admin', 'firebase-admin/*'];
// Browser storage packages that must only appear inside @salt/local-store.
const INDEXEDDB_PKGS = ['idb', 'idb/*', 'idb-keyval', 'idb-keyval/*', 'dexie', 'dexie/*'];
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
      '**/.boundary-tests/**',
    ],
  },

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
  },

  // boundaries: file-path-based import graph enforcement (packages only — apps are leaf nodes)
  {
    files: ['packages/**/*.ts'],
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
            { from: 'local-store', allow: ['domain', 'shared-types'] },
            { from: 'firebase-sync', allow: ['domain', 'shared-types'] },
            { from: 'ui-components', allow: [] },
            {
              from: 'testing-utils',
              allow: ['shared-types', 'domain', 'local-store', 'firebase-sync'],
            },
            {
              from: 'web-pwa',
              allow: ['shared-types', 'domain', 'local-store', 'firebase-sync', 'ui-components'],
            },
            {
              from: 'cloud-functions',
              allow: ['shared-types', 'domain', 'firebase-sync'],
            },
          ],
        },
      ],
    },
  },

  // Generic default: packages and boundary-test fixtures must not import apps.
  {
    files: ['packages/**/*.ts', '**/.boundary-tests/**/*.ts'],
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

  // @salt/domain — must not import firebase, IndexedDB, or anything outside shared-types.
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(
              SALT_APP_IMPORTS,
              'Packages must not import from apps. Apps are leaf nodes in the dependency graph.',
            ),
            ...forbidGroup(
              FIREBASE_PKGS,
              'Firebase SDK imports are only allowed in @salt/firebase-sync. Use the domain port instead.',
            ),
            ...forbidGroup(
              INDEXEDDB_PKGS,
              'Browser storage imports are only allowed in @salt/local-store. Use the domain port instead.',
            ),
            ...forbidGroup(
              [
                '@salt/local-store',
                '@salt/local-store/*',
                '@salt/firebase-sync',
                '@salt/firebase-sync/*',
                '@salt/ui-components',
                '@salt/ui-components/*',
                '@salt/testing-utils',
                '@salt/testing-utils/*',
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
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Packages must not import from apps.'),
            ...forbidGroup(
              [
                '@salt/domain',
                '@salt/domain/*',
                '@salt/local-store',
                '@salt/local-store/*',
                '@salt/firebase-sync',
                '@salt/firebase-sync/*',
                '@salt/ui-components',
                '@salt/ui-components/*',
                '@salt/testing-utils',
                '@salt/testing-utils/*',
              ],
              '@salt/shared-types must not import any other @salt/* package.',
            ),
          ],
        },
      ],
    },
  },

  // @salt/local-store — must not import Firebase SDKs or @salt/firebase-sync.
  {
    files: ['packages/adapters/local-store/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Adapters must not import from apps.'),
            ...forbidGroup(
              FIREBASE_PKGS,
              'Firebase SDK imports are only allowed in @salt/firebase-sync.',
            ),
            ...forbidGroup(
              ['@salt/firebase-sync', '@salt/firebase-sync/*'],
              'Adapters must not import each other. Compose them at the application layer.',
            ),
          ],
        },
      ],
    },
  },

  // @salt/firebase-sync — must not import IndexedDB packages or @salt/local-store.
  {
    files: ['packages/adapters/firebase-sync/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Adapters must not import from apps.'),
            ...forbidGroup(
              INDEXEDDB_PKGS,
              'Browser storage imports are only allowed in @salt/local-store.',
            ),
            ...forbidGroup(
              ['@salt/local-store', '@salt/local-store/*'],
              'Adapters must not import each other. Compose them at the application layer.',
            ),
          ],
        },
      ],
    },
  },

  // @salt/ui-components — must not import Firebase SDKs or browser storage packages.
  {
    files: ['packages/ui-components/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(FIREBASE_PKGS, 'UI components must not import Firebase SDKs.'),
            ...forbidGroup(
              INDEXEDDB_PKGS,
              'UI components must not import browser storage packages — go through @salt/local-store.',
            ),
          ],
        },
      ],
    },
  },

  // @salt/testing-utils — only inherits the generic "no apps" rule unless tightened later.
  {
    files: ['packages/testing-utils/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidGroup(SALT_APP_IMPORTS, 'Testing utilities must not import from apps.'),
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
              'Firebase SDK imports are only allowed in @salt/firebase-sync.',
            ),
            ...forbidGroup(
              INDEXEDDB_PKGS,
              'Browser storage imports are only allowed in @salt/local-store.',
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
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Packages must not import from apps.'),
            ...forbidGroup(
              [
                '@salt/domain',
                '@salt/domain/*',
                '@salt/local-store',
                '@salt/local-store/*',
                '@salt/firebase-sync',
                '@salt/firebase-sync/*',
                '@salt/ui-components',
                '@salt/ui-components/*',
                '@salt/testing-utils',
                '@salt/testing-utils/*',
              ],
              '@salt/shared-types must not import any other @salt/* package.',
            ),
          ],
        },
      ],
    },
  },

  {
    files: ['packages/adapters/local-store/src/__boundary_tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Packages must not import from apps.'),
            ...forbidGroup(
              FIREBASE_PKGS,
              'Firebase SDK imports are only allowed in @salt/firebase-sync.',
            ),
            ...forbidGroup(
              ['@salt/firebase-sync', '@salt/firebase-sync/*'],
              'Adapters must not import each other.',
            ),
          ],
        },
      ],
    },
  },

  {
    files: ['packages/adapters/firebase-sync/src/__boundary_tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Packages must not import from apps.'),
            ...forbidGroup(
              INDEXEDDB_PKGS,
              'Browser storage imports are only allowed in @salt/local-store.',
            ),
            ...forbidGroup(
              ['@salt/local-store', '@salt/local-store/*'],
              'Adapters must not import each other.',
            ),
          ],
        },
      ],
    },
  },
];
