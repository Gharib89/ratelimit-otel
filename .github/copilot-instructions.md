# Copilot review instructions

Review every pull request in this repo against `docs/contributing/coding-standards.md`. That file is canonical: read it rather than a summary of it, and raise a finding wherever the diff departs from it.

This repo is a Claude Code plugin made of function hooks. Two things about it change what counts as a defect:

- **The plugin API is early access and is not publicly documented.** The authority is the generated `.claude/types/claude-code.d.ts`, not code.claude.com and not training data. Do not raise a finding asserting that a `$` noun, a hook event or `register(on, options)` does not exist; check the declarations. A confident claim that part of this API is imaginary is the most likely wrong review of this repo.
- **The standards file records invariants that read as ordinary code smells and are not.** An empty argument list on `$.session.usage()`, a literal-only `$.env.get`, and a guard on `rateLimits.length` are each deliberate and each explained there.

Findings the repo most wants caught: summing an account-wide value across sessions, treating an absent rate-limit window as zero, passing `$` to anything but a top-level function, and a new test that was never confirmed red.
