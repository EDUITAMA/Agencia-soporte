# Architecture of the Autonomous SDLC Kit

## Components

### Primary orchestrator

`sdlc-orchestrator` owns workflow state and delegates all specialist work. It has access to the custom `sdlc_*` tools and cannot edit product code. This separates coordination from implementation.

### Specialist agents

Agents are organized by responsibility:

- discovery: repository profile;
- analysis: requirements and risk;
- design: architecture and test strategy;
- planning: ordered implementation tasks;
- execution: developer and test engineer;
- independent assurance: reviewer, security, performance and DevOps;
- communication: documentation;
- remediation: debugger;
- governance: judge.

Most specialists can write only their run report. The developer/debugger can modify product code; the test engineer can modify test-like paths; the judge cannot modify implementation.

### Skills

Skills hold detailed reusable methods and are loaded on demand. Per-agent skill permissions hide irrelevant skills, reducing both accidental role mixing and context cost.

### State and artifacts

Every run has a deterministic folder and `state.json`. Numbered Markdown artifacts form a pipeline of durable handoffs. The next agent consumes artifact paths rather than a copied conversation.

### Custom tools

`.opencode/tools/sdlc.js` provides:

- `sdlc_create_run`;
- `sdlc_configure_run`;
- `sdlc_advance_stage`;
- `sdlc_validate_gate`;
- `sdlc_record_gate`;
- `sdlc_begin_repair`;
- `sdlc_status` and `sdlc_list_runs`;
- `sdlc_record_human_approval` and `sdlc_close_run`;
- `sdlc_apply_models`.

The tool layer makes run creation, state transitions, gate structure, repair limits and model application deterministic instead of relying only on prompt compliance.

## Workflow

```text
request
  -> discovery
  -> requirements + risk
  -> intake gate
  -> architecture
  -> test strategy
  -> implementation plan
  -> design gate
  -> implementation
  -> implementation gate
  -> tests + independent audits
  -> verification gate
  -> judge
  -> final gate
  -> approved
```

A failed gate enters one bounded repair cycle and returns to the earliest impacted stage. Successful unrelated checks are reused.

## Risk adaptation

All runs have tests and review. Security, performance, DevOps and documentation are activated by the risk assessment and policy. Critical risk adds a human approval gate and prevents automatic APPROVED closure.

## Trust boundaries

- The worktree is the only automatic modification boundary.
- Protected environment/secret paths are denied.
- External directories are denied.
- Deployment, package publication, Git push/commit and destructive infrastructure/data commands are denied.
- Model providers are configured by the user; the kit does not embed credentials.

## Portability

The repository scout discovers commands and conventions from manifests, CI and documentation. Stack-specific overrides are optional. No language or test framework is assumed.
