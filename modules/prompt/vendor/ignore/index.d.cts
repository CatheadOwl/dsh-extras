// Minimal type surface for the vendored `ignore@5.3.2` CommonJS build.
// Only the two methods this package uses are declared; the full upstream
// surface (filter / createFilter / test / isPathValid) is intentionally omitted.
interface IgnoreInstance {
  add(patterns: string | readonly string[]): IgnoreInstance
  ignores(pathname: string): boolean
}
declare function ignore(options?: { ignorecase?: boolean }): IgnoreInstance
export = ignore
