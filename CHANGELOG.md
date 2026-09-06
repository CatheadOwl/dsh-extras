---
description: Release history of @catheadowl/dsh-extras — one entry per published version, following Keep a Changelog conventions
---

# Changelog

All notable changes to `@catheadowl/dsh-extras` are documented here. Versions
follow [Semantic Versioning](https://semver.org/); entries follow
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

### Added

- `prompt` module: tool-touch sensor lane. The framework now listens to
  `tools/result` (`read`/`edit`) itself and offers a second signal source to
  providers:
  - `sources?: Array<'prompt' | 'touch'>` — per-provider signal subscription;
    omitted keeps the previous prompt-only behavior exactly.
  - `touchSubjects?(touchedPath): string[]` — a pure reverse projection; one
    declaration drives both once-ledger invalidation (runs for every
    declarer, regardless of subscription or switches) and, for touch
    subscribers, pseudo-path re-offers at the next pre-step (`origin:
    'touch'` + `touchTool` provenance on the path).
  - Usage guide with the canonical pairing-provider pattern (steady-state
    `undefined`, self-edit reconciliation, `subjectOf`/`touchSubjects` mirror
    alignment) lives in the module's `docs/cookbook.md`; contract text in
    `docs/contract.md` ("tool-touch sensor lane").

### Compatibility

- Providers that declare nothing new behave identically (locked by an
  end-to-end v0-equivalence composition test). One deliberate tightening for
  imperative providers: contributions anchored at once-filtered paths are now
  discarded as unknown instead of accepted.

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

[0.1.2]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.1.2
[0.1.1]: https://github.com/CatheadOwl/dsh-extras/releases/tag/v0.1.1
