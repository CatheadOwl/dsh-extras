---
description: Release history of @catheadowl/dsh-extras — one entry per published version, following Keep a Changelog conventions
---

# Changelog

All notable changes to `@catheadowl/dsh-extras` are documented here. Versions
follow [Semantic Versioning](https://semver.org/); entries follow
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

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

[0.2.0]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.2.0
[0.1.2]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.1.2
[0.1.1]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.1.1
