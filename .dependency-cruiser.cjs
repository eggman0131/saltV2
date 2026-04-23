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
      name: 'no-import-web-pwa',
      severity: 'error',
      comment: 'Nothing outside web-pwa may import from the web-pwa app.',
      from: { pathNot: '^apps/web-pwa' },
      to: { path: '^apps/web-pwa' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules|dist' },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
