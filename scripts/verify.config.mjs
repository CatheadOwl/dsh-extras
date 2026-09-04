// Per-package config for the verify entries in this directory (consumer-
// owned). The entries are managed copies, byte-identical across every
// consumer — never edited here; the workspace gate-blueprint-drift rejects
// divergence. All per-package differences live in this file only.
export default {
  ownName: '@catheadowl/dsh-extras',
  devDepNonRegistryScopes: ['@deepseek-ai/', '@catheadowl/'],
  layout: 'modules',
  srcDirs: ['src'],
  docsRoots: ['docs', 'eval'],
  hostClosureCheck: true,
  rulesSeed: '.agent/rules/package-independence.md',
  packageFace: {
    ownName: '@catheadowl/dsh-extras',
    modulesDir: 'modules',
    rootEntry: 'modules/gates/src/index.ts',
    skipModules: ['gates'],
    loaderContract: ['name', 'inject', 'Config', 'apply'],
    // Public consumer entries of the bundle: subpath -> source file (relative
    // to the package root). Module loader entries are public subpaths
    // (row-name specifiers); modules without an exports entry simply have no
    // row here.
    subentries: {
      './gates': 'modules/gates/src/index.ts',
      './markdown': 'modules/markdown/src/index.ts',
      './prompt': 'modules/prompt/src/index.ts',
      './routes': 'modules/routes/src/index.ts',
      './gates/register': 'modules/gates/src/register.ts',
      './prompt/register': 'modules/prompt/src/register.ts',
      './markdown/gate-check': 'modules/markdown/src/gate-check.ts',
    },
    // Frozen facade for the register entry: the gates API face (w12). Adding
    // a public export requires updating this list (and regenerating
    // docs/register.md).
    facadeExports: {
      './gates/register': [
        'registerGate',
        'projectGateOptions',
        'GateChangeSet',
        'GateDefinition',
        'GateFixer',
        'GateFixerCommand',
        'GateFixerSubagent',
        'GateFixerSubagentRequest',
        'GateLevel',
        'GateRemedy',
        'GateRemedyManual',
        'GateRemedyOperation',
        'GateResult',
        'GateStatus',
        'GateTrigger',
        'GateViolation',
      ],
      './prompt/register': [
        'registerPromptMiddlewareProvider',
        'registerRelatesProvider',
        'PromptPathKind',
        'ResolvedPromptPath',
        'RelatesItem',
        'PromptRelatesContribution',
        'PromptMiddlewareInput',
        'PromptMiddlewareProviderMode',
        'PromptMiddlewareProvider',
        'PromptMiddlewareProviderEntry',
        'RelatesResolveContext',
        'RelatesResolveResult',
        'DeclarativeRelatesProvider',
        'PromptMiddlewareTraceStatus',
        'PromptMiddlewareTraceEvent',
        'PromptMiddlewareConfig',
        'PromptMiddlewareRunOptions',
        'PromptRelatesGroup',
        'PromptMiddlewareRunResult',
        'PromptMiddlewareProviderView',
      ],
    },
    forbiddenImports: [
      /from\s+['"]@catheadowl\/dsh-extras(?!\/(?:gates|prompt)\/register(?:\.js)?['"])[^'"]*['"]/u,
    ],
  },
}
