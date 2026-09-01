/** Generic module-gate fixture loaded through a project gates.yml. */
export function check(root) {
  return [{ reason: `fixture saw ${root}` }]
}
