/** Generic module-gate surface echoing the options overlay it received. */
export function check(root, _changes, options) {
  return [{ reason: `generic options ${JSON.stringify(options ?? null)} at ${root}` }]
}
