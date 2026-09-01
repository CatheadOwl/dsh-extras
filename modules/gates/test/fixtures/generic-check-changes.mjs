/** Generic module-gate surface that echoes the received change set. */
export function check(_root, changes) {
  return [{ reason: `generic saw changes ${JSON.stringify(changes)}` }]
}
