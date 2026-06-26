/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are not allowed anywhere.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-no-firebase',
      severity: 'error',
      comment: 'Domain layer must not import Firebase. Use the adapter pattern.',
      from: { path: '^packages/domain' },
      to: { path: '^node_modules/firebase' },
    },
    {
      name: 'domain-no-indexeddb',
      severity: 'error',
      comment: 'Domain layer must not import browser storage. Use the LocalStore port.',
      from: { path: '^packages/domain' },
      to: { path: '^node_modules/(idb|idb-keyval|dexie)' },
    },
    {
      name: 'shared-types-no-salt-imports',
      severity: 'error',
      comment: 'shared-types must not import other @salt packages.',
      from: { path: '^packages/shared-types' },
      to: { path: '^packages/(?!shared-types)' },
    },
    {
      name: 'packages-no-import-apps',
      severity: 'error',
      comment: 'Packages must not import from apps.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'domain-only-shared-types',
      severity: 'error',
      comment: 'Domain may only import @salt/shared-types from the @salt workspace.',
      from: { path: '^packages/domain' },
      to: { path: '^packages/(?!shared-types|domain)' },
    },
    {
      name: 'firebase-sync-no-indexeddb',
      severity: 'error',
      comment: '@salt/firebase-sync must not import browser storage. Offline reads/writes are handled by Firestore\'s persistentLocalCache.',
      from: { path: '^packages/adapters/firebase-sync' },
      to: { path: '^node_modules/(idb|idb-keyval|dexie)' },
    },
    {
      name: 'observability-no-firebase',
      severity: 'error',
      comment: '@salt/observability must not import Firebase SDKs.',
      from: { path: '^packages/adapters/observability' },
      to: { path: '^node_modules/firebase' },
    },
    {
      name: 'observability-no-indexeddb',
      severity: 'error',
      comment: '@salt/observability must not import browser storage.',
      from: { path: '^packages/adapters/observability' },
      to: { path: '^node_modules/(idb|idb-keyval|dexie)' },
    },
    {
      name: 'adapters-no-cross-import',
      severity: 'error',
      comment: 'firebase-sync and observability must not import each other. Compose them at the application layer.',
      from: { path: '^packages/adapters/(firebase-sync|observability)' },
      to: { path: '^packages/adapters/(firebase-sync|observability)', pathNot: '$0' },
    },
    {
      name: 'cloud-functions-no-observability-browser',
      severity: 'error',
      comment:
        'Cloud Functions must not import the browser side of @salt/observability. Use the /server subpath (posthog-node + Node OTel).',
      from: { path: '^apps/cloud-functions' },
      to: { path: '^packages/adapters/observability/src/(?!server/|shared/)' },
    },
    {
      name: 'web-pwa-no-observability-server',
      severity: 'error',
      comment:
        'web-pwa must not import the /server subpath of @salt/observability. Use the default subpath (browser posthog-js SDK).',
      from: { path: '^apps/web-pwa' },
      to: { path: '^packages/adapters/observability/src/server' },
    },
    {
      name: 'no-import-web-pwa',
      severity: 'error',
      comment: 'Nothing outside web-pwa may import from the web-pwa app.',
      from: { pathNot: '^apps/web-pwa' },
      to: { path: '^apps/web-pwa' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules|dist' },
    exclude: { path: 'playwright-report|test-results|__boundary_tests__' },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
