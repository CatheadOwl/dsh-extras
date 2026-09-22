// Frozen specimen: a paired-note provider over the touch lane.
// Companion to docs/cookbook.md — "完整模式：配对型 provider" and the
// atomic design "自编辑是推迟，不是吞掉". Do not evolve this file with the
// framework; the smoke test (test/examples.test.mjs) pins its ordering.

/**
 * Dependencies a consumer supplies; everything else is the pattern.
 *
 * @param {(path: string) => Promise<{ version: string, note: string } | undefined>} loadPairState
 *   Current derived state for one subject; `undefined` = no pairing.
 *   Must be cheap and side-effect free (called once per touch).
 * @param {(path: string) => string} [formatNote]
 *   Renders one state into the injected `value`; defaults to `state.note`.
 */
export function pairedNoteProvider({ loadPairState, formatNote }) {
  /** What the model has actually SEEN rendered, advanced only on render. */
  const rendered = new Map()

  return {
    name: 'paired-note',
    kind: 'paired-note',
    sources: ['prompt', 'touch'],
    // Bidirectional pairing: a touched path projects to its own subject here.
    // Real pairings (sidecar files, directory docs) map both directions
    // through the same table — and must stay mirror-aligned with `subjectOf`.
    touchSubjects: touched => [touched],

    async resolve({ path }) {
      const state = await loadPairState(path.path)
      if (state === undefined) return undefined

      // Discipline 2 (self-edit reconciliation): the agent's own edit is not
      // narrated back. MUST NOT advance `rendered` here — the signal lives in
      // the gap between what the model has seen and reality; advancing the
      // record to the post-edit reading would swallow it forever.
      if (path.origin === 'touch' && path.touchTool === 'edit') return undefined

      // Discipline 1 (steady-state silence): already rendered, unchanged →
      // say nothing. `rendered` advances ONLY on an actual render.
      if (rendered.has(path.path) && state.version === rendered.get(path.path)) return undefined
      rendered.set(path.path, state.version)

      return { value: (formatNote ?? (s => s.note))(state) }
    },
  }
}
