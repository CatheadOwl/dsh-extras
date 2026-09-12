/**
 * Model-facing wording for the `md_rename` tool. Lives in its own module so
 * the row's loader entry stays on the loader contract while the single SSOT
 * for the description is importable by tests (TD-1).
 *
 * The label clause is load-bearing (TD-2): the mirror rule changes bytes beyond
 * the destination, and without it a caller reads "rewrite every internal
 * reference" as license to rewrite arbitrary prose labels.
 */
export const MD_RENAME_DESCRIPTION =
  'Move a file or directory to a new path and rewrite every internal Markdown reference (links, images, definitions) so all links keep resolving. Deterministic and all-or-nothing: it plans the full edit set — in-link rewrite plus out-link rebase — before writing anything, then refuses the whole move on any hard conflict (newPath already exists, oldPath missing, or a path outside the repository). A link label that merely writes its own destination out — the path, its last segment, with or without the `.md` extension — is relabeled with it; any other label is author prose and stays untouched. If the move already happened — oldPath missing, newPath present, and git can witness the rename (a staged R record, a D record with the shifted file on disk, or a HEAD entry) — the same call repairs the links only (status "repaired", no move performed); without that evidence it refuses with a remedy hint instead of guessing. Prefer this tool over manually editing links for any Markdown move — including one you merely discover (a tracked path gone from disk, its content reappearing elsewhere): pass the (oldPath, newPath) pair and let it rewrite in-links and rebase the moved file\'s own out-links in one deterministic pass. The tool never restores or verifies already-moved content itself. References it cannot rewrite deterministically (already-broken links, external/absolute targets, and rebased destinations with unrepresentable characters) are skipped and reported, never guessed. oldPath and newPath are workspace-root-relative.'
