---
description: dsh-extras package homepage — one npm package of runtime-independent dsh plugin modules (gates / markdown / prompt / routes rows): install, modules, config, API face, and development
---

# @catheadowl/dsh-extras

English | [中文](README.zh.md)

One npm package, several **runtime-independent** [dsh](https://github.com/deepseek-ai/deepseek-harness) plugin modules: quality gates, Markdown link hygiene, prompt injection, and knowledge-base routing. `dsh plugin add` installs everything at once; every module can be toggled off by row id without affecting the others.

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

Each module is an independent row (fiber) in the Cordis composition: no shared state — disable any row and the others behave exactly as before.

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
The Web Settings tabs (gates / prompt) are loaded from the embedded nested anchor package inside this package — nothing to install separately.

The module dependency topology and the exports reconciliation table live in [docs/dependencies.md](docs/dependencies.md).

## Development

```powershell
# From this directory (the extras package root)
pnpm run build                  # four module libs + client bundle
pnpm run test:gates             # per-module unit tests (test:markdown / test:prompt / test:routes)
pnpm run verify:package-face    # exports / facade checks
pnpm run verify:publish-readiness  # release hygiene checks (docs locality, host closure, ...)
```

The host-closure check walks the npm registry over the network (10s timeout per request); on flaky networks use Node's built-in proxy support: `$env:NODE_USE_ENV_PROXY='1'; $env:HTTPS_PROXY='http://<proxy>'` (Node ≥ 24). Offline builds may set `DSH_SKIP_HOST_CLOSURE=1` to skip it (a red check is never allowed to silently turn green).

Builds borrow the toolchain from a host checkout (tsc / tsdown under `deepseek-harness/node_modules/.bin`, see the package.json scripts) — after cloning this repository, prepare a dsh checkout first; during development, host peers are resolved by junctioning `node_modules/@deepseek-ai/*` to the **workspace source directories** of the host checkout (same shape as the links inside the host CLI install's top-level node_modules). Each module's behavior evals (intent/regression cases) live in `modules/<m>/eval/`; see each module's eval README for the framework and how to run them.

## Known limitations

- Requires the dsh CLI (this package is a plugin carrier, not a standalone app); all runtime peers are provided by the host closure.
- The root README is bilingual (English primary + Chinese); module pages and deep docs are Chinese-first.
- Settings tabs currently exist only for the gates / prompt rows (loaded via the nested anchor package, not published separately).
- The gates consecutive-block cap (`maxConsecutiveBlocks`, default 3) **degrades to pass** when exhausted — it is a safety valve, not a correctness guarantee; the markdown / routes rows expose no plugin config keys.

## License

[MIT](LICENSE)
