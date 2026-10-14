# Customization

## Policy

Edit `.sdlc/config/policy.json` to change repair budget, risk examples, required checks, coverage defaults or stop conditions. Preserve supported check names because the custom tool maps them to report files.

## Stack overrides

Use `.sdlc/config/stack-overrides.json` only when discovery cannot infer commands. Null means automatic discovery. Keep commands repository-local and non-destructive.

## Agents

Agent prompts live in `.opencode/agents/`. Preserve filename prefixes so orchestrator task permissions continue to expose them. Keep specialist edit permissions narrower than the developer.

## Skills

Add a project skill at `.opencode/skills/<name>/SKILL.md`. Use lowercase hyphenated names and match directory/name. Grant it only to agents that need it.

## Commands

Add project commands under `.opencode/commands/`. A command should select a primary agent and state whether it creates a new run or operates on current state.

## Artifact contract

If report filenames/headings change, update all of:

1. agent output instruction;
2. `.sdlc/templates/`;
3. `ARTIFACT_HEADINGS` in `.opencode/tools/sdlc.js`;
4. gate file mappings;
5. documentation.

## Existing OpenCode configuration

When an existing `opencode.json` or `opencode.jsonc` is present, the installer does not overwrite it. Merge desired fields from `opencode.sdlc.recommended.jsonc`, especially `default_agent`, `compaction`, watcher ignores and safety permissions.
