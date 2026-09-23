---
description: Release history of @catheadowl/dsh-extras — one entry per published version, following Keep a Changelog conventions
---

# Changelog

All notable changes to `@catheadowl/dsh-extras` are documented here. Versions
follow [Semantic Versioning](https://semver.org/); entries follow
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

### Changed

- **The gates / enrichment configuration UI moves from the Settings
  "Built-in plugins" section to the Plugins page** (follows the upstream
  2026-09-16 move of the plugins-configuration home): on the
  `@catheadowl/dsh-extras` card each of the two rows now carries a Configure
  control opening its own page — the same switch form and write path, plus a
  one-liner summary; the Settings section no longer lists extras tabs.
  Registration slot `settings.plugins.tab` → `plugins.row.config` (keys
  `@catheadowl/dsh-extras#gates` / `#enrichment`); this move itself changes no
  npm-facing API (service keys, remote namespaces, storage keys unchanged —
  the register-face removal below is a separate change riding the same
  release).
  Requires a host whose web frontend ships the Plugins-page config slots
  (upstream ≥ 2026-09-16, e.g. `0.1.6-alpha.2`); on older hosts the
  configuration UI is simply absent — the server halves are unaffected.

### Removed

- **The `./gates/register` and `./enrichment/register` export subpaths are
  removed** (with their source files, the generated API references, and the
  `registerGate` / `registerEnrichmentProvider` / `registerRelatesProvider`
  helper exports). Consumer plugins register through the service seams
  instead — `ctx.inject(['gates'], c => c.gates.register(...))` /
  `ctx.inject(['enrichment'], ...)` with locally mirrored contract types —
  the same host-canonical soft-dependency ceremony every plugin already uses;
  no package dependency on `@catheadowl/dsh-extras` is needed. The host
  ecosystem has no importable-registration-helper form (its own in-tree
  consumers hand-write the ceremony), which this change realigns with.
  Migration: replace the hard import with structural mirrors + the inject
  ceremony (see `modules/gates/docs/adding-a-plugin-gate.md` and
  `modules/enrichment/docs/cookbook.md`). Consumers at removal time: none on
  npm (the one external consumer reverted to the mirror form in advance).

## [0.3.1] — 2026-09-23

### Changed

- **Breaking (0.x minor): the `prompt` module is renamed `enrichment`** — the
  engine word only; "middleware" over-claimed (nothing is rewritten, steered,
  or blocked) and under-described the multi-source design. Consumer-visible
  surfaces follow: exports `./prompt` → `./enrichment` (+ `./enrichment/register`),
  service key `ctx.promptMiddleware` → `ctx.enrichment`,
  `registerPromptMiddlewareProvider` → `registerEnrichmentProvider` (engine
  face — `registerRelatesProvider` keeps its name: family face), loader row id
  `prompt` → `enrichment`, Typert Remote namespace `promptMiddleware` →
  `enrichment`, Settings slot id / locale namespace `settings.enrichment` /
  localStorage key `dsh.enrichment.disabled`, trace `source.plugin` →
  `enrichment`. Deliberately frozen: the `relates:` / `related:` envelope,
  `[kind]` labels, `subject` / `subjectOf` / `touchSubjects` keys, and the
  `sources: 'prompt' | 'touch'` values are unchanged, so historical session
  envelopes stay valid. Migration: update inject keys / imports to the new
  names and bump the dependency.
- `routes` (`any_nav`): the tool description now documents the output-surface
  contracts a fresh reader could not derive — the response envelope (`root` /
  `anchor`, depth measured from `anchor`, the requested `routePath` echoed when
  passed), description provenance (frontmatter `description:`, else a
  `description:` line in the head, else the first substantive prose line), the
  flat ` | ` split rule (everything after the first separator is the
  description, which may itself contain ` | `), the Markdown-empty folder
  omission rule (`[truncated: 0]` never appears), and filter visibility
  (traversal filters apply without an echo; the `maxFiles` cutoff is the only
  mid-scan clip and always reports a `diagnostics` warning). The `format`
  parameter's tree-node field list now states when `markdown` / `description`
  appear and that `omittedMarkdownCount` is the same recursive `.md` total as
  flat's `[truncated: N]`. Wording only — no output schema or behavior change.
  Each added clause resolves one adjudicated comprehension finding (see the
  module's `eval/comprehension` adjudication record); the description exceeds
  the TD-4 soft word cap with those clauses as the accepted cost.

## [0.3.0] — 2026-09-19

### Changed

- `routes`: the breadcrumb annotation is value-only — the injected line is just
  the description chain, with no `meta` suffix. `source` restated what the
  `[breadcrumb-description]` kind label already identifies, and the contributing
  READMEs are trivially reconstructible from the directory tree, so under the
  prompt middleware's steady-state-silence discipline the provider no longer
  writes meta.
- `markdown` (metadata fixer): generated `description` frontmatter is now
  written in English regardless of the document body language — the summary
  feeds a language-agnostic router and must stay uniform with the code/symbol
  vocabulary it names. House-rule change only: the gate does not enforce
  language, so hand-written descriptions are untouched.
- `markdown` (`md_rename`): a link label that writes its own destination out —
  the path itself, or its last segment, with or without the `.md` extension —
  now follows the target when the file is renamed or moved, so an index can no
  longer keep advertising the old name after the target left. Any other label is
  author prose and stays byte-untouched; reference-definition keys (they are the
  key `[label]` usages resolve through) and markup labels (`` [`x.md`](x.md) ``)
  are never relabeled. A label is never a conflict and never blocks a
  destination rewrite, and a frozen source skips the whole rewrite as before.

### Added

- `markdown` (`md_rename`): the tool result now reports `relabels` (`{file,
  line, from, to}`) next to `edited` and `skips`, so the label half of an edit
  is auditable rather than implicit.
- `gates`: the enforced switch state is now readable outside the Web panel —
  every mirror write logs `gates: switches: stop off — <ids>; manual off —
  <ids>`, and `/gates` plus the `gates_run` result carry the same `switches:`
  line (new result field), so "why is this gate missing from the run" no longer
  needs the panel or a turn-timing reconstruction.

### Fixed

- `gates` (settings tab): workspace resolution follows the host
  0.1.6-alpha.2 session-ownership refactor (explicit Session ownership; the
  client-side global "current
  session" no longer exists, so the tab addresses the most recently active
  workspace (latest session activity, falling back to workspace creation
  time); the server-cwd fallback is unchanged. On refactored hosts the
  dropped selected-session tier had already been silently degrading to the
  same fallback.
- `prompt`: non-delivery trace events now surface at `logger.warn` instead of
  `logger.debug`. A provider that renders nothing (`failed`, `timed-out`) was
  invisible in the wild — debug logs are off by default, so a broken declarer
  looked like "nothing happens at all" rather than a diagnosable line.
  Designed degradation (`skipped`, `cancelled`, `truncated`) stays at debug,
  and `ok` stays silent; the split is documented in the module's trace
  contract.
- `gates`: a violation produced while a gate's **turn-stop** switch was off is
  no longer lost. The turn-end clean pass closes the dirty window only when the
  run covered the whole declared stop set — or when the window holds nothing
  unvouched — so re-enabling the switch reports the violation at the next
  turn-end, with its precise attribution path intact, instead of the turn
  finding a clean shortcut and forgetting it. Ordinary clean turns keep the
  incremental shortcut either way.

## [0.2.1] — 2026-09-11

### Fixed

- `gates`: the turn-stopping driver crashed once per turn with
  `Cannot read properties of undefined (reading 'length')` on dsh hosts from
  0.1.2-alpha.4 onward — upstream removed the `session.events` getter
  (5660f44d29) in favor of `snapshotEvents()`. Beyond the error line, turn-end
  gates had silently stopped running since the host upgrade; the driver now
  reads `snapshotEvents()` and the composition tests await the async
  `agentLoop.create`.

### Added

- `gates`: host capability assertion at activation — a host dsh lacking
  `Session#snapshotEvents` now fails loud with a named host-version error at
  load time instead of dying opaque once per turn.
- `routes` (`any_nav`): a silent `maxFiles` budget stop now emits a
  `file-limit-reached` diagnostic, and `[truncated: N]` counts honor
  `.gitignore` rules along the scan (including nested ones), so N equals what
  descending into that directory would actually list.

### Compatibility

- **Minimum host: a dsh release from 0.1.2-alpha.4 onward** (requires
  `Session#snapshotEvents`). Host peer ranges stay `*` deliberately: the host
  is pre-stable 0.x across two version axes (CLI releases vs per-package
  versions), so a semver floor neither maps to what consumers install nor
  survives link-resolved profiles; the startup assertion is the enforced bound.

## [0.2.0] — 2026-09-09

### Changed

- **Breaking (0.x minor)**: `routes` tool renamed `any_routes` → `any_nav`; the
  breadcrumb provider's `meta.source` string follows. Update prompts and eval
  fixtures that hardcode the old name — the `./routes` subpath and the loader
  row id are unchanged.
- `markdown` (`md-metadata`) gate: homepage exemption widened — a `README.md`
  at a root carrying `package.json` **or** `.gitignore` is skipped;
  fixed-convention basenames (`AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`,
  `CONTRIBUTING.md`) are exempt wherever they sit; repos can append their own
  via the new `exempt-basenames` gate option.
- `gates`: the config-guide skill is now visible to model sessions (was
  user-only) — gate executors are frequently models.
- Behavior tightening: imperative prompt contributions anchored at
  once-filtered paths are now discarded as unknown (previously accepted).

### Added

- `prompt`: tool-touch sensor lane — providers can subscribe to a second
  signal source (`sources: Array<'prompt' | 'touch'>`) and declare a
  `touchSubjects` reverse projection (session-context aware) to re-offer
  touched subjects at the next pre-step, with the touch signal sourced from
  read/edit tool results. Pairing-provider guide in the module's
  `docs/cookbook.md`.
- `prompt`: `introspect()` read-only snapshot — per-provider sources,
  `effectiveEnabled`, and `disabledBy` provenance; consumed by the Settings
  tab.
- `prompt`: optional provider `description` field, rendered in the Settings
  tab; fail-loud at registration when malformed.
- `prompt`: meta annotation channel — `renderRelates` can project a neutral
  visible suffix onto relates lines.

### Fixed

- `prompt`: subject matching and leaf ordering are case-insensitive end to
  end; directory group keys render with a trailing slash while dedupe/once
  ledgers keep canonical paths (display form vs identity form separated).

## [0.1.2] — 2026-09-05

### Fixed

- `md-metadata` gate: files doubling as a package/repository homepage
  (`README.md` at a package root) are now exempt from the description
  requirement — GitHub renders them raw, and frontmatter shows up as noise.
- Release-face documentation fixes (package homepage and module docs).

## [0.1.1] — 2026-09-03

### Added

- Initial public lineup: four server plugin rows — `gates` (turn-close
  quality gates), `markdown` (`md_rename` tool + doc-link/md-metadata gates),
  `prompt` (declarative prompt injection), `routes` (knowledge routing) —
  installable together via `dsh plugin add @catheadowl/dsh-extras`, each row
  individually disableable.
- Nested client anchor package `@catheadowl/dsh-extras-client` providing the
  Settings-tab UI face (Gates / Prompt tabs).

## [0.1.0] — 2026-09-03

Deprecated shortly after publish; superseded by [0.1.1]. Use 0.1.1 or later.

[0.3.0]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.3.0
[0.2.1]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.2.1
[0.2.0]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.2.0
[0.1.2]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.1.2
[0.1.1]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.1.1
