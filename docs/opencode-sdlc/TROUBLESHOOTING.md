# Troubleshooting

## Agents or commands do not appear

Confirm OpenCode was started from the repository or a child directory inside the same Git worktree. Verify filenames are under `.opencode/agents/` and `.opencode/commands/`. Restart OpenCode after installing or changing these files.

## Skill not found

Check that the file is exactly `SKILL.md`, the frontmatter `name` matches the directory, and the agent permission allows the skill.

## Custom `sdlc_*` tools do not appear

Confirm `.opencode/tools/sdlc.js` exists and OpenCode can load `@opencode-ai/plugin`. Start OpenCode with logs enabled and inspect startup errors. Do not rename the file unless you also update tool names in prompts.

## Model application fails

Use exact IDs shown by `/models`, with `provider/model-id` format. Set unsupported roles back to `inherit`. Backups are under `.sdlc/backups/`.

## Verification gate reports missing artifacts

Run `/sdlc-status current`, open the named run directory and compare files/headings with `.sdlc/templates/`. Resume the run; do not manually mark the gate PASS.

## Test engineer cannot edit a test path

Its generic permission allows paths containing `test`, `spec`, `fixture` or `snapshot`. For unusual test layouts, either customize the agent permission or have the orchestrator treat it as BLOCKED. Do not grant broad production edit access merely for convenience.

## Existing opencode config

Merge `opencode.sdlc.recommended.jsonc` into the project config. Configuration files are not automatically merged by the installer because JSONC and project-specific permission semantics can be complex.

## Repair budget exhausted

The run should close BLOCKED. Increase `maxRepairLoops` only after reviewing why previous repairs failed; otherwise a higher limit can hide a requirements or architecture problem.


## AXET bridge folder shown as the environment

The provider process may run from a folder such as `opencode-axet-bridge`. That is not the application repository. v1.3 calls `sdlc_project_context` and locks every stage to the OpenCode project root. If a subagent cannot access that root, it must stop with `BLOCKED_WRONG_ROOT`.

## `axet-code timeout after 180000ms` after files were created

Do not blindly repeat the implementation. The provider may have lost only the final response. v1.3 records a stage checkpoint before delegation. On resume it compares the checkpoint, expected artifact and Git worktree. If side effects exist, it validates/reuses them instead of reapplying the same changes.
