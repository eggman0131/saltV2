import boundaries from 'eslint-plugin-boundaries';
import tsParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import playwright from 'eslint-plugin-playwright';

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
    type: 'observability',
    pattern: ['packages/adapters/observability/**', '@salt/observability'],
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
  {
    type: 'kitchen-sink',
    pattern: ['apps/kitchen-sink/**', '@salt/kitchen-sink'],
  },
  {
    type: 'storybook',
    pattern: ['apps/storybook/**', '@salt/storybook'],
  },
];

// Import specifier patterns that must never appear in certain layers.
const FIREBASE_PKGS = ['firebase', 'firebase/*', 'firebase-admin', 'firebase-admin/*'];
// Browser storage packages forbidden everywhere — Firestore's persistentLocalCache is the offline layer.
const INDEXEDDB_PKGS = ['idb', 'idb/*', 'idb-keyval', 'idb-keyval/*', 'dexie', 'dexie/*'];
// PostHog SDKs may be imported only inside @salt/observability, which wraps
// them behind the ErrorReporting / MatchLogging ports (browser posthog-js on
// the default subpath, posthog-node on /server). Everything else — apps
// included — depends on those ports, never the SDK directly. depcruise's
// no-posthog-outside-observability closes the same gap over the resolved tree.
const POSTHOG_PKGS = ['posthog-js', 'posthog-js/*', 'posthog-node', 'posthog-node/*'];
const POSTHOG_MESSAGE =
  'PostHog SDK imports (posthog-js / posthog-node) are only allowed in @salt/observability. Depend on the @salt/observability ports (default subpath in web-pwa, /server in cloud-functions) instead.';
const SALT_APP_IMPORTS = [
  '@salt/web-pwa',
  '@salt/web-pwa/*',
  '@salt/cloud-functions',
  '@salt/cloud-functions/*',
  '@salt/kitchen-sink',
  '@salt/kitchen-sink/*',
  '@salt/storybook',
  '@salt/storybook/*',
];

// UI-primitive libraries. web-pwa must reach these only through
// @salt/ui-components (Rule 7) — a direct import bypasses the wrapper layer.
// ui-components itself owns these deps and imports them directly.
const UI_PRIMITIVE_PKGS = [
  'bits-ui',
  'bits-ui/*',
  'shadcn-svelte',
  'shadcn-svelte/*',
  'melt-ui',
  'melt-ui/*',
  '@melt-ui/svelte',
  '@melt-ui/*',
];
const UI_PRIMITIVE_MESSAGE =
  'UI primitives (bits-ui / shadcn-svelte / melt-ui) must be imported via @salt/ui-components, never directly (Rule 7).';

// Node built-ins + browser storage globals forbidden in @salt/domain: the domain
// layer is pure (no I/O, no Node, no browser APIs). `node:*` covers the modern
// prefix; the bare names cover the legacy specifier form.
const NODE_BUILTIN_PKGS = [
  'node:*',
  'fs',
  'fs/*',
  'path',
  'os',
  'crypto',
  'util',
  'stream',
  'child_process',
  'http',
  'https',
  'net',
  'zlib',
  'events',
  'process',
];
const DOMAIN_NODE_MESSAGE =
  '@salt/domain is pure — no Node built-ins or I/O. Move platform code into an adapter.';
const DOMAIN_BROWSER_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'navigator',
];
const DOMAIN_BROWSER_GLOBALS_MESSAGE =
  '@salt/domain is pure — no browser APIs. Move platform code into an adapter.';

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
const DOMAIN_MODULES = ['canon', 'recipe', 'auth', 'equipment', 'shoppingList'];
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
  ...forbidGroup(POSTHOG_PKGS, POSTHOG_MESSAGE),
  ...forbidGroup(NODE_BUILTIN_PKGS, DOMAIN_NODE_MESSAGE),
  ...forbidGroup(
    [
      '@salt/firebase-sync',
      '@salt/firebase-sync/*',
      '@salt/observability',
      '@salt/observability/*',
      '@salt/ui-components',
      '@salt/ui-components/*',
      '@salt/testing-utils',
      '@salt/testing-utils/*',
    ],
    '@salt/domain may only import @salt/shared-types from the workspace.',
  ),
];

// Browser + Node globals forbidden in @salt/domain (pure layer). Applied via
// no-restricted-globals on the domain catch-all block; not overridden by the
// per-module/coordinator blocks (they only set no-restricted-imports).
const DOMAIN_RESTRICTED_GLOBALS = [
  ...DOMAIN_BROWSER_GLOBALS.map((name) => ({ name, message: DOMAIN_BROWSER_GLOBALS_MESSAGE })),
  { name: 'process', message: DOMAIN_NODE_MESSAGE },
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
    ],
  },

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
  },

  // .svelte files: parse the component with svelte-eslint-parser and its
  // <script lang="ts"> block with the TS parser, so `import` statements inside
  // <script> are visible to no-restricted-imports / boundaries. Only the parser
  // is wired in (not eslint-plugin-svelte's rule set) — the goal is import-graph
  // enforcement, not Svelte style linting (issue #413). The boundary rule blocks
  // below extend their globs to `.{ts,svelte}` so a <script> import cannot
  // bypass the layer contract.
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tsParser },
    },
  },

  // e2e Playwright specs: mechanise the NF-spec flake rules via the plugin's
  // flat/recommended set — errors on the correctness rules (missing-playwright-await,
  // prefer-web-first-assertions, no-networkidle, no-focused-test, valid-*), warns on
  // style. no-eval is OFF — the window.__e2e bridge runs via page.evaluate. The two
  // legit negative-hold waitForTimeouts carry inline eslint-disable + NF-A2 reasons.
  {
    files: ['apps/web-pwa/e2e/**/*.ts'],
    plugins: { playwright },
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-eval': 'off',
    },
  },

  // boundaries: file-path-based import graph enforcement (packages only — apps are leaf nodes)
  {
    files: ['packages/**/*.{ts,svelte}'],
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
            { from: 'observability', allow: ['domain', 'shared-types'] },
            { from: 'ui-components', allow: [] },
            {
              from: 'testing-utils',
              allow: ['shared-types', 'domain', 'firebase-sync'],
            },
            {
              from: 'web-pwa',
              allow: ['shared-types', 'domain', 'firebase-sync', 'observability', 'ui-components'],
            },
            {
              from: 'cloud-functions',
              allow: ['shared-types', 'domain', 'observability'],
            },
          ],
        },
      ],
    },
  },

  // Generic default: packages and boundary-test fixtures must not import apps.
  {
    files: ['packages/**/*.{ts,svelte}', '**/.boundary-tests/**/*.ts'],
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

  // @salt/domain — catch-all: must not import firebase, IndexedDB, Node built-ins,
  // or anything outside shared-types, and must not touch browser/Node globals.
  // Per-module and coordinator rules below override no-restricted-imports for
  // files within those scopes, but no-restricted-globals (set only here) still
  // applies to them.
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: DOMAIN_BASE_PATTERNS }],
      'no-restricted-globals': ['error', ...DOMAIN_RESTRICTED_GLOBALS],
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
            ...forbidGroup(POSTHOG_PKGS, POSTHOG_MESSAGE),
            ...forbidGroup(
              [
                '@salt/domain',
                '@salt/domain/*',
                '@salt/firebase-sync',
                '@salt/firebase-sync/*',
                '@salt/observability',
                '@salt/observability/*',
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
            ...forbidGroup(POSTHOG_PKGS, POSTHOG_MESSAGE),
            ...forbidGroup(
              ['@salt/observability', '@salt/observability/*'],
              'Adapters must not import each other. Compose them at the application layer.',
            ),
          ],
        },
      ],
    },
  },

  // @salt/observability — must not import Firebase SDKs, IndexedDB, or sibling adapters.
  {
    files: ['packages/adapters/observability/**/*.ts'],
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
    files: ['packages/ui-components/**/*.{ts,svelte}'],
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
            ...forbidGroup(POSTHOG_PKGS, POSTHOG_MESSAGE),
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
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Testing utilities must not import from apps.'),
            ...forbidGroup(POSTHOG_PKGS, POSTHOG_MESSAGE),
          ],
        },
      ],
    },
  },

  // Boundary-test fixtures: apply the same restrictions as their target layer.
  // (no-restricted-globals is inherited from the domain catch-all block above.)
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
            ...forbidGroup(NODE_BUILTIN_PKGS, DOMAIN_NODE_MESSAGE),
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
                '@salt/observability',
                '@salt/observability/*',
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
              ['@salt/observability', '@salt/observability/*'],
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
              name: '@salt/observability',
              message:
                'Cloud Functions must not import the default @salt/observability subpath (browser posthog-js SDK). Use @salt/observability/server instead.',
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
  // Includes .svelte fixtures so the <script> import path is exercised (#413).
  {
    files: ['apps/web-pwa/src/__boundary_tests__/**/*.{ts,svelte}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@salt/observability/server',
              message:
                'web-pwa must not import @salt/observability/server (posthog-node + Node OTel). Use the default @salt/observability subpath.',
            },
          ],
          patterns: [
            ...forbidGroup(UI_PRIMITIVE_PKGS, UI_PRIMITIVE_MESSAGE),
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
  // Also enforces the observability subpath split: web-pwa uses the default
  // subpath, cloud-functions uses /server.
  {
    files: ['apps/web-pwa/src/**/*.{ts,svelte}'],
    ignores: ['**/__boundary_tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@salt/observability/server',
              message:
                'web-pwa must not import @salt/observability/server (posthog-node + Node OTel). Use the default @salt/observability subpath.',
            },
          ],
          patterns: [
            ...forbidGroup(POSTHOG_PKGS, POSTHOG_MESSAGE),
            ...forbidGroup(UI_PRIMITIVE_PKGS, UI_PRIMITIVE_MESSAGE),
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
              name: '@salt/observability',
              message:
                'Cloud Functions must not import the default @salt/observability subpath (browser posthog-js SDK). Use @salt/observability/server instead.',
            },
          ],
          patterns: [
            ...forbidGroup(POSTHOG_PKGS, POSTHOG_MESSAGE),
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

  // @salt/kitchen-sink — a dev-only UI-components showcase (issue #414). Layer
  // map: kitchen-sink → ui-components ONLY. It must reach UI primitives through
  // @salt/ui-components (Rule 7) and must not pull in any other @salt/* package,
  // Firebase, browser storage, or the PostHog SDK. Apps are leaf nodes, so this
  // is enforced via no-restricted-imports (not boundaries/element-types).
  {
    files: ['apps/kitchen-sink/src/**/*.{ts,svelte}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Apps are leaf nodes — do not import another app.'),
            ...forbidGroup(UI_PRIMITIVE_PKGS, UI_PRIMITIVE_MESSAGE),
            ...forbidGroup(FIREBASE_PKGS, 'kitchen-sink must not import Firebase SDKs.'),
            ...forbidGroup(INDEXEDDB_PKGS, 'Browser storage (IndexedDB) imports are forbidden.'),
            ...forbidGroup(POSTHOG_PKGS, POSTHOG_MESSAGE),
            ...forbidGroup(
              [
                '@salt/shared-types',
                '@salt/shared-types/*',
                '@salt/domain',
                '@salt/domain/*',
                '@salt/firebase-sync',
                '@salt/firebase-sync/*',
                '@salt/observability',
                '@salt/observability/*',
                '@salt/testing-utils',
                '@salt/testing-utils/*',
              ],
              'kitchen-sink is a UI showcase — it may import @salt/ui-components only.',
            ),
          ],
        },
      ],
    },
  },

  // @salt/storybook — a dev-only UI-components Storybook (mirror of kitchen-sink).
  // Layer map: storybook → ui-components ONLY. It must reach UI primitives through
  // @salt/ui-components (Rule 7) and must not pull in any other @salt/* package,
  // Firebase, browser storage, or the PostHog SDK. Apps are leaf nodes, so this
  // is enforced via no-restricted-imports (not boundaries/element-types).
  {
    files: ['apps/storybook/src/**/*.{ts,svelte}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidGroup(SALT_APP_IMPORTS, 'Apps are leaf nodes — do not import another app.'),
            ...forbidGroup(UI_PRIMITIVE_PKGS, UI_PRIMITIVE_MESSAGE),
            ...forbidGroup(FIREBASE_PKGS, 'storybook must not import Firebase SDKs.'),
            ...forbidGroup(INDEXEDDB_PKGS, 'Browser storage (IndexedDB) imports are forbidden.'),
            ...forbidGroup(POSTHOG_PKGS, POSTHOG_MESSAGE),
            ...forbidGroup(
              [
                '@salt/shared-types',
                '@salt/shared-types/*',
                '@salt/domain',
                '@salt/domain/*',
                '@salt/firebase-sync',
                '@salt/firebase-sync/*',
                '@salt/observability',
                '@salt/observability/*',
                '@salt/testing-utils',
                '@salt/testing-utils/*',
              ],
              'storybook is a UI showcase — it may import @salt/ui-components only.',
            ),
          ],
        },
      ],
    },
  },
];
