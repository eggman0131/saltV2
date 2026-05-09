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
    type: 'firebase-sync',
    pattern: ['packages/adapters/firebase-sync/**', '@salt/firebase-sync'],
  },
  {
    type: 'ld-observability',
    pattern: ['packages/adapters/ld-observability/**', '@salt/ld-observability'],
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
// Browser storage packages forbidden everywhere (no local-store remains to own them).
const INDEXEDDB_PKGS = ['idb', 'idb/*', 'idb-keyval', 'idb-keyval/*', 'dexie', 'dexie/*'];
const SALT_APP_IMPORTS = [
  '@salt/web-pwa',
  '@salt/web-pwa/*',
  '@salt/cloud-functions',
  '@salt/cloud-functions/*',
];

// Stage 1–4 / stage 5 internals that must only be reached via findClosestMatch
// (or, in domain itself, matchOrCreate). Apps must never call these directly.
const STAGE_INTERNAL_NAMES = ['tokenMatch', 'stringSimilarity', 'synonymMatch', 'embedMatch'];
const STAGE_INTERNAL_SUBPATHS = [
  '@salt/domain/**/queries/tokenMatch*',
  '@salt/domain/**/queries/stringSimilarity*',
  '@salt/domain/**/queries/synonymMatch*',
  '@salt/domain/**/queries/embedMatch*',
];
const STAGE_INTERNAL_MESSAGE =
  'Stage 1–5 internals (tokenMatch, stringSimilarity, synonymMatch, embedMatch) must not be called directly from apps. Use findClosestMatch (which composes stages 1–4) or call the matchOrCreateCanon CF.';

function forbidGroup(pkgs, message) {
  return pkgs.map((g) => ({ group: [g], message }));
}

// Domain submodules. Add a module name here when scaffolding it.
const DOMAIN_MODULES = ['canon', 'recipe', 'shopping', 'auth'];
// Subfolders that constitute a domain module's internals. Cross-module
// subpath imports into these are forbidden — go through the module index.
const DOMAIN_INTERNAL_SUBFOLDERS = ['entities', 'ports', 'commands', 'queries'];

function crossModuleSubpathPatterns(modules) {
  const patterns = [];
  for (const mod of modules) {
    for (const sub of DOMAIN_INTERNAL_SUBFOLDERS) {
      patterns.push(`**/${mod}/${sub}`);
      patterns.push(`**/${mod}/${sub}/**`);
    }
  }
  return patterns;
}

const COORDINATOR_PATTERNS = ['**/coordinators', '**/coordinators/**'];

const DOMAIN_BASE_PATTERNS = [
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
    'Browser storage (IndexedDB) imports are forbidden — use the Firestore persistent cache instead.',
  ),
  ...forbidGroup(
    [
      '@salt/firebase-sync',
      '@salt/firebase-sync/*',
      '@salt/ld-observability',
      '@salt/ld-observability/*',
      '@salt/ui-components',
      '@salt/ui-components/*',
      '@salt/testing-utils',
      '@salt/testing-utils/*',
    ],
    '@salt/domain may only import @salt/shared-types from the workspace.',
  ),
];

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.svelte-kit/**',
      '**/__boundary_tests__/**',
      '**/.boundary-tests/**',
      'apps/web-pwa/e2e/**',
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
            { from: 'firebase-sync', allow: ['domain', 'shared-types'] },
            { from: 'ld-observability', allow: ['domain', 'shared-types'] },
            { from: 'ui-components', allow: [] },
            {
              from: 'testing-utils',
              allow: ['shared-types', 'domain', 'firebase-sync', 'ld-observability'],
            },
            {
              from: 'web-pwa',
              allow: [
                'shared-types',
                'domain',
                'firebase-sync',
                'ld-observability',
                'ui-components',
              ],
            },
            {
              from: 'cloud-functions',
              allow: ['shared-types', 'domain', 'firebase-sync', 'ld-observability'],
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

  // @salt/domain — catch-all: must not import firebase, IndexedDB, or anything outside shared-types.
  // Per-module and coordinator rules below override this for files within those scopes.
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: DOMAIN_BASE_PATTERNS }],
    },
  },

  // Per-module rules: each domain module may only import the published index
  // of sibling modules, never their internals. Modules must not depend on
  // coordinators.
  ...DOMAIN_MODULES.map((mod) => ({
    files: [`packages/domain/src/${mod}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...DOMAIN_BASE_PATTERNS,
            ...forbidGroup(
              crossModuleSubpathPatterns(DOMAIN_MODULES.filter((m) => m !== mod)),
              'Cross-module subpath imports are forbidden. Import the sibling module via its published index (e.g. "../canon"), not its internals.',
            ),
            ...forbidGroup(
              COORDINATOR_PATTERNS,
              'Domain modules must not depend on coordinators. Coordinators depend on modules, not the other way around.',
            ),
          ],
        },
      ],
    },
  })),

  // Coordinators: may import any module's published surface, but never
  // another module's internals.
  {
    files: ['packages/domain/src/coordinators/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...DOMAIN_BASE_PATTERNS,
            ...forbidGroup(
              crossModuleSubpathPatterns(DOMAIN_MODULES),
              'Coordinators must import only the published index of each module, never their internals (entities/ports/commands/queries).',
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
                '@salt/firebase-sync',
                '@salt/firebase-sync/*',
                '@salt/ld-observability',
                '@salt/ld-observability/*',
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

  // @salt/firebase-sync — must not import IndexedDB packages or sibling adapters.
  {
    files: ['packages/adapters/firebase-sync/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Adapters must not import from apps.'),
            ...forbidGroup(INDEXEDDB_PKGS, 'Browser storage (IndexedDB) imports are forbidden.'),
            ...forbidGroup(
              ['@salt/ld-observability', '@salt/ld-observability/*'],
              'Adapters must not import each other. Compose them at the application layer.',
            ),
          ],
        },
      ],
    },
  },

  // @salt/ld-observability — must not import Firebase SDKs, IndexedDB, or sibling adapters.
  {
    files: ['packages/adapters/ld-observability/**/*.ts'],
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
            ...forbidGroup(INDEXEDDB_PKGS, 'Browser storage (IndexedDB) imports are forbidden.'),
            ...forbidGroup(
              ['@salt/firebase-sync', '@salt/firebase-sync/*'],
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
              'UI components must not import browser storage (IndexedDB) packages.',
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
            ...forbidGroup(INDEXEDDB_PKGS, 'Browser storage (IndexedDB) imports are forbidden.'),
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
                '@salt/firebase-sync',
                '@salt/firebase-sync/*',
                '@salt/ld-observability',
                '@salt/ld-observability/*',
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
    files: ['packages/adapters/firebase-sync/src/__boundary_tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Packages must not import from apps.'),
            ...forbidGroup(INDEXEDDB_PKGS, 'Browser storage (IndexedDB) imports are forbidden.'),
            ...forbidGroup(
              ['@salt/ld-observability', '@salt/ld-observability/*'],
              'Adapters must not import each other.',
            ),
          ],
        },
      ],
    },
  },

  {
    files: ['packages/adapters/ld-observability/src/__boundary_tests__/**/*.ts'],
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
            ...forbidGroup(INDEXEDDB_PKGS, 'Browser storage (IndexedDB) imports are forbidden.'),
            ...forbidGroup(
              ['@salt/firebase-sync', '@salt/firebase-sync/*'],
              'Adapters must not import each other.',
            ),
          ],
        },
      ],
    },
  },

  // Cloud Functions boundary-test fixtures: enforce CF-specific import restrictions.
  {
    files: ['apps/cloud-functions/src/__boundary_tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          // `paths` is exact-match; `patterns` uses minimatch with matchBase:true
          // which would over-match (e.g. forbidding the default subpath would
          // also forbid /server).
          paths: [
            {
              name: '@salt/ld-observability',
              message:
                'Cloud Functions must not import the default @salt/ld-observability subpath (browser SDK). Use @salt/ld-observability/server instead.',
            },
          ],
          patterns: [
            ...forbidGroup(STAGE_INTERNAL_SUBPATHS, STAGE_INTERNAL_MESSAGE),
            {
              group: ['@salt/domain', '@salt/domain/*'],
              importNames: STAGE_INTERNAL_NAMES,
              message: STAGE_INTERNAL_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // web-pwa boundary-test fixtures: enforce that internal subpaths of sibling
  // adapters are never imported directly — only the published package root.
  {
    files: ['apps/web-pwa/src/__boundary_tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@salt/ld-observability/server',
              message:
                'web-pwa must not import @salt/ld-observability/server (Node SDK). Use the default @salt/ld-observability subpath.',
            },
          ],
          patterns: [
            ...forbidGroup(
              ['@salt/firebase-sync/src', '@salt/firebase-sync/src/**'],
              'web-pwa must not import firebase-sync internals. Use the published package root (@salt/firebase-sync) only.',
            ),
            ...forbidGroup(STAGE_INTERNAL_SUBPATHS, STAGE_INTERNAL_MESSAGE),
            {
              group: ['@salt/domain', '@salt/domain/*'],
              importNames: STAGE_INTERNAL_NAMES,
              message: STAGE_INTERNAL_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // Apps (production code): must not call canon stage internals directly.
  // findClosestMatch (stages 1–4) and matchOrCreate are the only allowed entry points.
  // Also enforces the ld-observability subpath split: web-pwa uses the default
  // subpath, cloud-functions uses /server.
  {
    files: ['apps/web-pwa/src/**/*.ts'],
    ignores: ['**/__boundary_tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@salt/ld-observability/server',
              message:
                'web-pwa must not import @salt/ld-observability/server (Node SDK). Use the default @salt/ld-observability subpath.',
            },
          ],
          patterns: [
            ...forbidGroup(STAGE_INTERNAL_SUBPATHS, STAGE_INTERNAL_MESSAGE),
            {
              group: ['@salt/domain', '@salt/domain/*'],
              importNames: STAGE_INTERNAL_NAMES,
              message: STAGE_INTERNAL_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/cloud-functions/src/**/*.ts'],
    ignores: ['**/__boundary_tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@salt/ld-observability',
              message:
                'Cloud Functions must not import the default @salt/ld-observability subpath (browser SDK). Use @salt/ld-observability/server instead.',
            },
          ],
          patterns: [
            ...forbidGroup(STAGE_INTERNAL_SUBPATHS, STAGE_INTERNAL_MESSAGE),
            {
              group: ['@salt/domain', '@salt/domain/*'],
              importNames: STAGE_INTERNAL_NAMES,
              message: STAGE_INTERNAL_MESSAGE,
            },
          ],
        },
      ],
    },
  },
];
