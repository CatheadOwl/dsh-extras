---
description: Contributor guide for @catheadowl/dsh-extras — package-independence ground rules, per-module test/verify commands to run before submitting, and PR scoping
---

# Contributing to @catheadowl/dsh-extras

Thanks for your interest! 中文简介：本包是 dsh 插件模块集合，欢迎 issue 与 PR；提交前请跑过包内门禁（见下）。

## Ground rules

- This package is a **publishable unit**: docs and code must not link outside the
  package root; references to external evidence go by name, not by path.
  The `pnpm run verify:publish-readiness` gate enforces this mechanically.
- Each `modules/<m>/` is a runtime-independent plugin row — no cross-module
  imports; shared logic is not vendored twice.
- Changes to a module's public face (exports, register API, config keys) need a
  matching update to that module's README and, for gates, the frozen facade
  checked by `pnpm run verify:package-face`.

## Before you submit

```powershell
pnpm run build                    # requires a dsh host checkout for the toolchain — see README "Development"
pnpm run test:gates               # plus test:markdown / test:prompt / test:routes for the modules you touched
pnpm run verify:package-face
pnpm run verify:publish-readiness
pnpm run verify:readme-i18n       # bilingual README pairing — edit both sides, then re-record (see README.i18n.yaml header)
```

## Pull requests

Keep the change scoped to one module row (or one cross-cutting concern);
conflicting scopes should be raised as an issue first.
