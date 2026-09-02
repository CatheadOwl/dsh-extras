/**
 * Model-facing wording for the `any_routes` tool. Lives in its own module so
 * the row's loader entry stays on the loader contract (ADR 0001) while the
 * description-contract test keeps importing the single SSOT.
 */
export const ANY_ROUTES_DESCRIPTION =
  'Build a routing view from Markdown descriptions under a directory: folders are represented by their README.md (its description, when present). Use before exploring an unfamiliar Markdown knowledge base to pick a folder route. Route lines are always workspace-root-relative full paths (e.g. `explorer/sandbox-containment/containment.md`), never relative to the selected route root, and are sorted case-insensitively by route path. Every line is either a Markdown file route (with ` | description` when the file has one) or a depth-truncated folder rendered as `[truncated: N] folder-path` (with ` | description` when the folder\u2019s README has one), where N is the folder\u2019s recursive .md count (the total that would expand on descent). `routeCount` counts route entries (files plus truncated folders), not raw .md files or structural tree nodes. Returns route paths and descriptions, never file content.'
