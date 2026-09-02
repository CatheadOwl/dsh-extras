// Resolve the TypeScript compiler for the verification scripts.
//
// Resolution order:
//   1. DSH_TYPESCRIPT_PATH env var pointing at a typescript.js (explicit override)
//   2. a normal `typescript` install resolvable from this package (own
//      devDependency install, or the dev-repo junction convention)
//
// No hardcoded sibling-checkout paths here: the dev repository wires the host
// compiler in through the filesystem (node_modules/typescript junction), the
// same convention used for the @deepseek-ai/* peer junctions.
export async function loadTypeScript() {
  const override = process.env.DSH_TYPESCRIPT_PATH
  if (override) {
    return import(new URL(override, `file://${process.cwd()}/`).href)
  }
  try {
    return await import('typescript')
  }
  catch (error) {
    throw new Error(
      `cannot resolve typescript from the extras package; install dev dependencies, link a node_modules/typescript junction, or set DSH_TYPESCRIPT_PATH (${error.message})`,
    )
  }
}
