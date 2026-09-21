# Eval rubric — answer key

This is the **grading standard** for the reviewer runs. The reviewer (`prompt.md`-driven fresh model) never sees this file; it sees only the tool description + hop outputs. You, the human, compare each reviewer's three parts against this key.

The eval measures **semantic comprehension only** — "can a fresh model read the routing view and know which `routePath` to take next". Field *presence/shape* is already locked deterministically by `test/navigation.test.mjs`; do not re-grade it here.

## Per-field key (expected understanding)

| Field / line form | Expected understanding |
|---|---|
| `root` | Absolute workspace root (shown here as the stable `<workspace-root>` placeholder). |
| `anchor` | Absolute path of the route root this view is anchored at; **depth is measured from here**. hop-1 = `<workspace-root>`; hop-2 = `<workspace-root>/explorer`; hop-3 = `<workspace-root>/explorer/sandbox-containment`. |
| `depth` / `format` | Echo of the call parameters (defaults 0 / flat). |
| `routePath` | Echoed **only when the call passed one** (absent in hop-1); echoed in normalized slash form (`explorer`, never `./explorer` or `explorer/`). |
| `routeCount` | Number of route entries produced = file lines + `[truncated]` lines (NOT a raw .md file count). |
| `diagnostics` | Always present; empty when nothing to report. The maxFiles budget is the only mid-scan cutoff and adds a `file-limit-reached` warning when it clips the scan. |
| `routes[]` | Flat lines. Each is either a Markdown file (`relative/path.md`, with a description suffix when the file has one) or a depth-truncated folder `[truncated: N] folder-path`. |
| `tree` (only when `format: "tree"`) | Nested nodes instead of flat lines; same truncation/description semantics as flat. |
| `path` (tree node) | Workspace-root-relative route path. For files it is the full `.md` path (`explorer/README.md`); for folders the folder path. |
| `markdown` (tree node) | On a truncated folder, its `README.md` path (the "folder represented by README"); absent on file nodes and on truncated folders without a README. |
| `kind` (tree node) | `"file"` or `"folder"`; absent on structural-only nodes. |
| `truncated` / `omittedMarkdownCount` (tree node) | Truncated folder only; `omittedMarkdownCount` is exactly the `N` shown as `[truncated: N]` in flat. |
| structural-only node (tree) | A node with only `path` + `children` (no `kind`/`markdown`/`description`) — hierarchy scaffolding, not a navigable entry; flat skips it. |
| `[truncated: N] folder-path` | A folder at the depth boundary, not descended into. N = recursive .md count under it. A folder with no .md content under it is omitted entirely — `[truncated: 0]` never appears. |
| description suffix (`\| description`) | Present only when the file has a description, or a truncated folder borrows its README's description. The separator is the FIRST ` \| ` on the line: the route path is everything before it, the description (which may itself contain ` \| `) everything after. A description comes from the document itself — frontmatter `description:`, else a `description:` line in its head, else its first substantive prose line. |

## Per-hop expected next action

| Hop | The agent should … |
|---|---|
| hop-1 (root, depth 1) | Read the `explorer` subtree; see `[truncated: 2] explorer/sandbox-containment \| Sandbox containment` and pass `routePath: "explorer"` (or `explorer/sandbox-containment`) next. |
| hop-2 (routePath explorer, depth 1) | See `sandbox-containment`/`compact` now expand to file lines; pass `routePath: "explorer/sandbox-containment"` next. |
| hop-3 (routePath explorer/sandbox-containment, depth 1) | See exactly 2 file lines and no truncation; the target `containment.md` is present; use `read` (or similar) to get its content — this tool returns routes only. |
| hop-4 (routePath explorer, format tree) | See the same `explorer` subtree as nested nodes; reconcile `omittedMarkdownCount` with the flat `[truncated: N]`, read a file's full `.md` path from its `path`, and a truncated folder's README from `markdown`. |

## Known intentional design — do NOT count these as errors

A reviewer "red flag" is only a real finding if it is NOT one of the deliberate choices below. If a reviewer flags only these, the output is understood correctly.

1. **`[truncated: N]` counts recursive .md, not "lines shown" or "direct children"** — deliberate: N stays stable regardless of which scan root observes the folder. (hop-1 shows `explorer/_TEMPLATE` as `[truncated: 3]`; hop-2 shows it split as `[truncated: 2] …/evidence` + `[truncated: 1] …/guide`; 2 + 1 = 3.)
2. **`depth` is relative to the route root, not the workspace root** — the same folder truncates when observed from above and expands when it is the route root (e.g. `compact` truncated in hop-1, expanded in hop-2). Deliberate; `anchor` names the reference point.
3. **A truncated folder borrows its README's description; no README → bare name** — `sandbox-containment` has a description, `compact` does not. Description presence is NOT a file/folder discriminator.
4. **An expanded folder emits no bare folder line; its README is a normal `.md` file line** — the folder's existence is implied by the namespaced child paths.
5. **`routeCount` = file lines + `[truncated]` lines (= flat line count), not a raw .md file count** — deliberate: it is an entry count, renamed from the earlier misleading `scannedFiles`.
6. **The tool returns route views only, never file content** — reading the target note needs another tool. Deliberate boundary.
7. **`root`/`anchor` are absolute; `routePath`/`routes` use `/`** — platform reality (and `run.js` substitutes `<workspace-root>` for the temp path). Not a design defect.
8. **Route lines are workspace-root-relative, never anchor-relative** — in hop-3 (`anchor` = `explorer/sandbox-containment`) the routes are still the full `explorer/sandbox-containment/…` paths. Deliberate; the description now states it.
9. **`depth: 1` from the root shows folders two levels deep** (e.g. `explorer/compact`) with no `[truncated] explorer` line — a known easy misread of "descend N levels"; the depth-0 wording and hop-2/hop-3 disambiguate it. Accepted wording risk, not a defect.
10. **Tree file `path` is the full `.md` path (same as the flat file line)** — deliberate: tree is flat's nested twin, so a file's `path` is its `.md` path; `markdown` exists only on truncated folders (their README).
11. **Tree structural-only nodes (`path` + `children`, no `kind`)** are hierarchy scaffolding, not entries — flat skips them; they are not a bug.
12. **Truncation count has two spellings across formats** — flat embeds it in the line prefix `[truncated: N]`, tree names it `omittedMarkdownCount` (with `truncated: true`). Deliberate: a flat line is one string, so N must live in the prefix; a tree node is an object, so it gets named fields. Both spellings state the same "recursive .md total"; renaming the published tree field now would break consumers for zero comprehension gain.
13. **The recorded hop sequence is a fixture choice, not a prescribed path** — the tool accepts any folder route as `routePath` directly (hop-1 already names `explorer/sandbox-containment`, so jumping straight there is legal); the fixture's extra confirmation hop and tree re-render demonstrate behavior, not "shortest route" guidance the tool owes. Non-minimal trajectories are not a defect.
14. **Flat cannot distinguish a truncated folder without a README from one whose README has no description** — both render as the bare `[truncated: N] folder-path`. Deliberate: a flat line is one string with no fields; tree's `markdown` is the named-field disambiguator, and the navigation consequence is identical either way (descend, or read the derivable `folder/README.md` if it exists).

## How to grade a run

1. Read the reviewer's Part 1 and check the per-field key above. A field is "understood" if the reviewer's meaning matches, even in different wording.
2. Read Part 2 and check the per-hop table. The reviewer must correctly distinguish `[truncated: N]` (cut off — do not descend) from expanded files, and must realize `depth` is relative to the route root.
3. Read Part 3. A red flag is a **real finding only** if it is not in the known-intentional list above. Real findings are actionable design gaps.
4. Across N runs, aggregate: fields/actions all runs agree on = converged; disagreements or real (non-listed) red flags = investigate.
