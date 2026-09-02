# AGENTS.md

`@catheadowl/dsh-extras` is a single-package multi-row Cordis plugin carrier: each `modules/<m>/` is a runtime-independent dsh plugin row. Package face, layout, and commands: [README.md](README.md).

## Conventions

- **Published docs are self-contained**: readers have only this package. README/docs/eval link in-package paths only; cite out-of-package sources by name ("upstream doc", "original design record"), never by path directions.
- **Relative path tokens in prose resolve in-package**: escaping or dangling forms fail `scripts/verify-publish-readiness.mjs` (docs locality); forms the gate cannot judge are governed by this file.
- **Example data uses neutral namespaces** (`guides/`, `notes/x.md`), never a real repository's namespaces — examples must not be misread as citations.
- **Comments carry functional semantics only**; design attribution (why it is designed this way, decision provenance) lives in the cognition layer, not in source comments.
- **Host borrows are the documented exception**: `deepseek-harness` checkout paths and `@deepseek-ai/*` host packages are legal in dev-time wiring — runtime is provided by the dsh host, and the publish gates carry the matching exemptions.
