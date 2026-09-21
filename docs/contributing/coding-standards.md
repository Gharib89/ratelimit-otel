# Coding standards

The standards every change in this repo is reviewed against. The `code-review` skill's Standards axis and every automated reviewer read this file; the ship profile names it under `## Coding standards`.

## Enforced by tooling

- `tsc --noEmit`, per `tsconfig.json`, over `.claude/types` and the hooks module.
- `claude plugin validate . --strict`, per `.claude-plugin/plugin.json`. It reads the plugin the way the engine will and refuses what the engine would, so its capability list is the surface a reviewer judges without opening the source.
- `gitleaks detect`, per the `secrets` gate in `scripts/local-gate.sh`, required in every lane.

All three run in `scripts/local-gate.sh`. This repo has no CI, so a check that does not run there does not run at all.

## Written standards

None recorded in `CLAUDE.md` yet: `/init` has not run on this repo. The plugin-API invariants below stand in until it has, and move into `CLAUDE.md` when it does.

## Conventions a reviewer should know

The entries under the rule are ship's, true in every repo that installs it. The entries above it are this repo's own, each measured against a running build rather than read from public documentation.

- **The plugin's only job is rate-limit window utilization.** Claude Code's official OTel exporter already ships session, lines-of-code, PR, commit, cost, token, tool-decision and active-time metrics. A change that emits anything already in that set is duplication, not coverage.
- **`$.session.usage()` takes no arguments.** Passing `breakdown` issues a token-count request per tool and per memory file, the way `/context` does. On a per-turn hook that is a real cost on every seat, so the argument list stays empty.
- **`rateLimits` is account-wide, never per session.** Every concurrent session on one account reports the same numbers. Aggregate with max per `(account, kind, resetsAt)` and treat `resetsAt` as the window identity, so a rollover opens a new series instead of reading as a drop to zero. Summing across sessions or machines is always wrong.
- **`rateLimits` absent is not `rateLimits` zero.** It is empty at `session.start` and fills only after an API response; it is empty on an account with no subscription reading; a gateway returns `kind: "spend_limit"` in place of the two time windows; and `resetsAt` is optional. Guard on length and on the kind, never on a default.
- **`$.env.get` takes a literal string, and `$` reaches only top-level functions.** The engine enumerates what a module reads, so a computed variable name defeats the listing `claude plugin validate` prints, and passing `$` to a closure fails validation outright.
- **The generated `.claude/types/claude-code.d.ts` is the API reference.** Regenerate it with `claude -p "/plugin-types"` after a Claude Code update; never edit it. Public documentation does not cover function hooks at all and a docs search on this API returns confident wrong answers, so a claim about the plugin API is backed by the declarations or by a run, not by a citation.
- **A hooks module that does nothing is the expected failure of a missing flag.** `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` gates the whole feature and defaults off, and without it the module silently does not load: no error, no log. Check it first when nothing happens, and remember that console and policy env outrank user settings, which outrank process env.

- **PR body: seven sections, in order.** `## Why the change`, `## Change outline`, `## Special things to note`, `## Needs attention`, `## Verification`, `## Review`, `## Attribution`. Every body carries all seven, template or not, because ship writes the headings it does not find; a missing one is a finding, and `## Attribution` last is what keeps a section rewrite from swallowing the footer.
- **PR body: `## Change outline` carries a Shape.** A `diff` fence over a call tree, control flow, pseudocode or component tree, under `## Change outline`, which every body carries because ship writes the heading where no template gives it. Text forms only; mermaid and HTML are out. One behavioural fence per PR, about 15 lines or fewer, with a carrier file tree after it only where the same edit lands in more than two files. Every node is a real symbol, each tree's root node carries its file path, and no line carries a line number. `Shape: none, mechanical (<kind>).` replaces the fence only where the reviewer's question is "did the text change correctly", never where it is "what does X now do"; silent absence is a finding either way.
- **A vocabulary the change extends is swept across the whole tree, sibling spellings included.** Grep the new term and the ones it sits beside, across every file rather than the ones the diff already opened; a stale spelling left in the copy nobody grepped reads as the current rule to the agent that finds it first.
- **A rule-shaped prose change reaches every item it governs, one outcome each.** Enumerate the items the rule names and check the change lands on each exactly once; an item the rewrite skipped, or one left carrying two answers, is where a reviewer finds five rounds of work.
- **A new test is run once with the fix reverted, and confirmed red.** A test written to prove a fix proves nothing until it has failed for the reason it exists: revert the hunk, watch the case fail, restore it, watch it pass. A vacuous assertion reads from a diff exactly like a sound one, so no reviewer catches this and the proof is the author's, before the push.
- **New pattern-matching code is tested against adversarial inputs.** Delimiters inside the field, option groups, field-versus-line anchoring, and the path where the tooling itself fails; ten lines of regex read as correct and answer wrong on the input nobody wrote a case for.
- **A fix landed after review has its hunk re-read before the push.** Read the changed lines back out of the file, not out of the reply you are about to post; a fix applied to the wrong copy or applied by half costs a whole round to discover.
