---
description: Homepage of the @catheadowl/dsh-extras npm package — a dsh plugin carrier wrapping the turn-close hook into a composable quality-gate framework and shipping doc-maintenance modules (Markdown link hygiene, project-knowledge injection, knowledge-base routing).
---

# @catheadowl/dsh-extras

English | [中文](README.zh.md)

**Doing harness work is doing docs work.** `@catheadowl/dsh-extras` keeps the knowledge your [dsh](https://github.com/deepseek-ai/deepseek-harness) agent runs on healthy. It wraps dsh's turn-close hook into a composable quality-gate framework — one registration face (`registerGate`) instead of every plugin grabbing the hook — and ships the doc-maintenance components that philosophy implies: Markdown link hygiene, project-knowledge injection into the session, and routing views over Markdown knowledge bases.

`dsh plugin add` installs everything at once; every module is a separately toggleable composition row (identified by row id) and can be disabled without affecting the others. What this package is relative to the dsh host — and why it wraps host hooks at all — is covered in [docs/host.md](docs/host.md).

## Install

```powershell
dsh plugin add @catheadowl/dsh-extras
```

Requires the dsh CLI. All runtime dependencies come from the dsh host (peerDependencies, resolved against the host at `plugin add`); the package itself carries only a few pure-JS utility dependencies.

## Modules

| Module | Row id | What it provides | Docs |
|---|---|---|---|
| gates | `gates` | Quality-gate framework (`ctx.gates`): composable gates run automatically at turn close, plus the `registerGate` consumer face | [modules/gates/README.md](modules/gates/README.md) |
| markdown | `markdown` | `md_rename` tool (move a Markdown file and rewrite every internal link) + the `doc-link` gate + the bundled link-transaction library | [modules/markdown/README.md](modules/markdown/README.md) |
| prompt | `prompt` | Prompt-injection service (declarative providers + bundled parse/tree libraries) that injects project knowledge into the session | [modules/prompt/README.md](modules/prompt/README.md) |
| routes | `routes` | `any_routes` tool (routing views over Markdown knowledge bases) + the breadcrumb relates provider | [modules/routes/README.md](modules/routes/README.md) |

Each module is an independently toggleable row in the host's plugin composition: no shared state — disable any row and the others behave exactly as before.

## Configuration

Disable a single module by row id in your profile patch layer:

```yaml
- id: gates
  disabled: true
```

Modules with defaults can be overridden. All config keys per row:

| Row | Config keys |
|---|---|
| gates | `maxConsecutiveBlocks` (consecutive-block cap, default 3; exhausted → degrade to pass) |
| prompt | `providerTimeoutMs` / `totalTimeoutMs` / `renderBudgetChars` (example below) |
| markdown / routes | no plugin config keys |

```yaml
- id: prompt
  config:
    providerTimeoutMs: 2000
    totalTimeoutMs: 5000
    renderBudgetChars: 4000
```

Adding or removing modules happens through package versions: upgrade this package, then `dsh plugin update` shrinks or grows the composition rows.

## API face

Beyond the composition rows, the package exports stable subpaths for plugin developers:

- `@catheadowl/dsh-extras/gates/register` — the gates plugin consumer face (`registerGate` + the `GateDefinition` / `GateViolation` types).

Secondary consumer faces per module (e.g. markdown's repo-level `gates.yml` fallback) are documented in each module's README.
The Web Settings tabs (gates / prompt) are loaded from the bundled client sub-package inside this package (`modules/client`) — nothing to install separately.

The module dependency topology and the exports reconciliation table live in [docs/dependencies.md](docs/dependencies.md).

## Development

```powershell
# From the repository root
pnpm run build                  # four module libs + client bundle
pnpm run test:gates             # per-module unit tests (test:markdown / test:prompt / test:routes)
pnpm run verify:package-face    # exports / facade checks
pnpm run verify:publish-readiness  # release hygiene checks (docs locality, host closure, ...)
```

Development details — host checkout placement, toolchain borrow, peer junctions, and the host-closure network check — live in [docs/development.md](docs/development.md).

## Known limitations

- Requires the dsh CLI (this package is a plugin carrier, not a standalone app); all runtime peers are provided by the host closure.
- The root README is bilingual (English primary + Chinese); module pages and deep docs are Chinese-first.
- Settings tabs currently exist only for the gates / prompt rows (loaded via the bundled client sub-package, `modules/client`, not published separately).
- The gates consecutive-block cap (`maxConsecutiveBlocks`, default 3) **degrades to pass** when exhausted — it is a safety valve, not a correctness guarantee; the markdown / routes rows expose no plugin config keys.

## License

[MIT](LICENSE)
