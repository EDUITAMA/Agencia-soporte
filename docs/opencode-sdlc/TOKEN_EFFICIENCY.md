# Token Efficiency Design

## Why artifacts save tokens

Long multiagent chats repeatedly transmit the same request, architecture and code context. This kit persists each stage in a compact artifact. Delegated prompts pass paths and identifiers instead of copied documents.

## Lazy skill loading

OpenCode exposes only the skills allowed for each role. An architect does not receive implementation/test skill descriptions; a documentation agent does not receive security methods. The full skill body loads only when the agent calls it.

## Search-first exploration

Agents must search for filenames/symbols before reading. The repository profile caches stable facts such as commands, architecture and relevant paths. Later roles expand only invalidated or uncertain areas.

## Diff-first verification

Review roles begin with the current diff and acceptance criteria. They read neighboring code only when necessary to trace behavior. Generated and vendored files are not loaded wholesale.

## Risk-adaptive depth

Low-risk work avoids unnecessary performance/DevOps/security deep dives. High-risk work pays for them because the error cost justifies the context.

## Bounded repair

Infinite agent loops are prevented by `maxRepairLoops`. After a fix, only impacted checks rerun. Successful unrelated evidence remains valid.

## Compaction

The recommended `opencode.jsonc` enables automatic compaction and pruning of old tool outputs with a reserved token buffer. Reports preserve essential facts when conversational context is compacted.

## Practical tuning

- Keep artifact summaries under 200 words when possible.
- Keep subagent parent returns under 350 words.
- Put exact command output in evidence only when needed; store a concise result otherwise.
- Prefer focused tests before full suites.
- Use economical models for deterministic work.
- Update the repository profile rather than rediscovering the entire codebase.
