import { tool } from "@opencode-ai/plugin"
import { promises as fs } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { classifyRequest, buildRoutingDecision } from "./routing.mjs"
import { createActivityEvent, formatActivity, reconcileModel } from "./activity.mjs"
import { createGraphState, startNode, applyNodeResult, resumeGraph, recordTechnicalRetry } from "./graph/graph-engine.mjs"
import { loadGraphState, saveGraphState } from "./graph/state-store.mjs"
import { parseNodeResult } from "./graph/node-result.mjs"

const execFileAsync = promisify(execFile)

const STAGES = [
  "intake",
  "discovery",
  "requirements",
  "design",
  "planning",
  "implementation",
  "verification",
  "repair",
  "judgment",
  "complete",
]

const RISKS = ["UNCLASSIFIED", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
const CHECKS = ["tests", "review", "security", "performance", "devops", "docs", "human-approval"]
const GATES = ["intake", "design", "implementation", "verification", "final"]

const ARTIFACT_HEADINGS = {
  "01-repository-profile.md": [
    "# Repository Profile",
    "## Stack",
    "## Commands",
    "## Architecture Map",
    "## Constraints",
    "## Relevant Files",
  ],
  "02-requirements.md": [
    "# Requirements",
    "## Problem",
    "## Scope",
    "## Acceptance Criteria",
    "## Non-Functional Requirements",
    "## Open Decisions",
  ],
  "03-risk-assessment.md": [
    "# Risk Assessment",
    "## Risk Level",
    "## Risk Drivers",
    "## Required Checks",
    "## Human Gates",
  ],
  "04-architecture.md": [
    "# Architecture",
    "## Decision",
    "## Components",
    "## Data and Contracts",
    "## Failure Modes",
    "## Security",
    "## Observability",
    "## Rollback",
  ],
  "05-test-strategy.md": [
    "# Test Strategy",
    "## Traceability Matrix",
    "## Test Levels",
    "## Negative and Edge Cases",
    "## Test Commands",
    "## Exit Criteria",
  ],
  "06-implementation-plan.md": [
    "# Implementation Plan",
    "## Tasks",
    "## Dependency Order",
    "## Verification per Task",
    "## Rollback",
  ],
  "07-implementation-report.md": [
    "# Implementation Report",
    "## Summary",
    "## Files Changed",
    "## Decisions",
    "## Verification",
    "## Known Limitations",
  ],
  "08-test-report.md": [
    "# Test Report",
    "## Environment",
    "## Commands and Results",
    "## Requirement Coverage",
    "## Failures",
    "## Flakiness",
    "## Verdict",
  ],
  "09-review-report.md": [
    "# Code Review",
    "## Scope",
    "## Findings",
    "## Requirement Compliance",
    "## Test Adequacy",
    "## Verdict",
  ],
  "10-security-report.md": [
    "# Security Review",
    "## Threat Surface",
    "## Findings",
    "## Dependency and Secret Checks",
    "## Verdict",
  ],
  "11-performance-report.md": [
    "# Performance Review",
    "## Hot Paths",
    "## Evidence",
    "## Findings",
    "## Verdict",
  ],
  "12-devops-report.md": [
    "# DevOps Review",
    "## Delivery Impact",
    "## Configuration",
    "## Rollback",
    "## Findings",
    "## Verdict",
  ],
  "13-documentation-report.md": [
    "# Documentation Report",
    "## Updated Documentation",
    "## Operational Notes",
    "## Remaining Gaps",
    "## Verdict",
  ],
  "14-judge-decision.md": [
    "# Judge Decision",
    "## Decision",
    "## Gate Evidence",
    "## Blocking Findings",
    "## Residual Risk",
    "## Required Follow-Up",
  ],
}

const BASE_GATE_FILES = {
  intake: ["00-request.md", "01-repository-profile.md", "02-requirements.md", "03-risk-assessment.md"],
  design: ["04-architecture.md", "05-test-strategy.md", "06-implementation-plan.md"],
  implementation: ["07-implementation-report.md"],
  verification: ["08-test-report.md", "09-review-report.md"],
  final: ["14-judge-decision.md"],
}

const CHECK_FILES = {
  security: "10-security-report.md",
  performance: "11-performance-report.md",
  devops: "12-devops-report.md",
  docs: "13-documentation-report.md",
}

function now() {
  return new Date().toISOString()
}

function projectRoot(context) {
  return path.resolve(context.worktree || context.directory)
}

function sdlcRoot(context) {
  return path.join(projectRoot(context), ".sdlc")
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex")
}

async function gitSnapshot(root) {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const text = String(stdout || "")
    return {
      available: true,
      hash: hashText(text),
      changedEntries: text ? text.split(/\r?\n/).filter(Boolean).length : 0,
      summary: text.split(/\r?\n/).filter(Boolean).slice(0, 40),
    }
  } catch (error) {
    return {
      available: false,
      hash: null,
      changedEntries: null,
      summary: [],
      error: String(error?.message || error),
    }
  }
}

const STAGE_ARTIFACTS = {
  "repo-scout": ["01-repository-profile.md"],
  "requirements": ["02-requirements.md", "03-risk-assessment.md"],
  "architect": ["04-architecture.md"],
  "test-designer": ["05-test-strategy.md"],
  "planner": ["06-implementation-plan.md"],
  "developer": ["07-implementation-report.md"],
  "test-engineer": ["08-test-report.md"],
  "reviewer": ["09-review-report.md"],
  "security": ["10-security-report.md"],
  "performance": ["11-performance-report.md"],
  "devops": ["12-devops-report.md"],
  "docs": ["13-documentation-report.md"],
  "judge": ["14-judge-decision.md"],
  "debugger": [],
}

async function existingStageArtifacts(context, runId, stageName) {
  const runDir = runDirectory(context, runId)
  const expected = STAGE_ARTIFACTS[stageName] || []
  const found = []
  for (const fileName of expected) {
    if (await pathExists(path.join(runDir, fileName))) found.push(fileName)
  }
  return { expected, found }
}

function assertSafeSegment(value, label) {
  if (!value || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, dot, underscore or hyphen`)
  }
  return value
}

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42)
  return slug || "work"
}

function parseCsv(value, allowed = null) {
  const values = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  const unique = [...new Set(values)]
  if (allowed) {
    for (const item of unique) {
      if (!allowed.includes(item)) throw new Error(`Unsupported value: ${item}`)
    }
  }
  return unique
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8")
  return JSON.parse(raw)
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  try {
    await fs.rename(temporary, filePath)
  } catch {
    await fs.rm(filePath, { force: true })
    await fs.rename(temporary, filePath)
  }
}

function runDirectory(context, runId) {
  return path.join(sdlcRoot(context), "runs", assertSafeSegment(runId, "runId"))
}

async function currentRunId(context) {
  const pointer = path.join(sdlcRoot(context), "current-run.json")
  if (!(await pathExists(pointer))) throw new Error("No current SDLC run exists")
  const value = await readJson(pointer)
  return assertSafeSegment(value.runId, "current runId")
}

async function resolveRunId(context, runId) {
  if (!runId || runId === "current") return currentRunId(context)
  return assertSafeSegment(runId, "runId")
}

async function loadState(context, runId) {
  const resolved = await resolveRunId(context, runId)
  const filePath = path.join(runDirectory(context, resolved), "state.json")
  if (!(await pathExists(filePath))) throw new Error(`Run state not found: ${resolved}`)
  return { runId: resolved, filePath, state: await readJson(filePath) }
}

async function saveState(filePath, state, event, details = {}) {
  state.updatedAt = now()
  state.history = Array.isArray(state.history) ? state.history : []
  state.history.push({ at: state.updatedAt, event, ...details })
  if (state.history.length > 200) state.history = state.history.slice(-200)
  await writeJsonAtomic(filePath, state)
}

async function graphConfiguration(context) {
  const policy = await readJson(path.join(sdlcRoot(context), "config", "policy.json"))
  const graph = policy.graphEngine || {}
  return {
    enabled: graph.enabled === true,
    deliveryModes: Array.isArray(graph.deliveryModes) ? graph.deliveryModes : ["PLAN_BUILD"],
    maxRepairCycles: Number.isInteger(graph.maxRepairCycles) ? graph.maxRepairCycles : 3,
    maxReviewCycles: Number.isInteger(graph.maxReviewCycles) ? graph.maxReviewCycles : 2,
  }
}

async function graphSelections(context) {
  const models = await readJson(path.join(sdlcRoot(context), "config", "models.json"))
  const roles = { PLAN: "sdlc-planner", IMPLEMENT: "sdlc-developer", TEST: "sdlc-test-engineer", REPAIR: "sdlc-developer", REVIEW: "sdlc-reviewer" }
  return Object.fromEntries(Object.entries(roles).map(([node, agent]) => [node, { agent, selectedModel: models[agent] || null, configuredModel: models[agent] || null, actualModel: null }]))
}

function parseOptionalJson(value, field) {
  if (!value || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error("must be an array")
    return parsed
  } catch (error) {
    throw new Error(`${field} must be a JSON array: ${error.message}`)
  }
}

function extractSection(content, heading) {
  const start = content.indexOf(heading)
  if (start < 0) return ""
  const after = content.slice(start + heading.length)
  const next = after.search(/\n##\s+/)
  return (next < 0 ? after : after.slice(0, next)).trim()
}

function reportVerdictIssue(fileName, content) {
  if (fileName === "14-judge-decision.md") {
    const decision = extractSection(content, "## Decision").toUpperCase()
    if (!/\b(APPROVED|REJECTED)\b/.test(decision)) return "Decision must contain APPROVED or REJECTED"
    if (/\bREJECTED\b/.test(decision)) return "Judge decision is REJECTED"
    return null
  }

  if (/^(08|09|10|11|12|13)-/.test(fileName)) {
    const verdict = extractSection(content, "## Verdict").toUpperCase()
    if (!/\b(PASS|PASS_WITH_WARNINGS|FAIL|BLOCKED|NOT_REQUIRED)\b/.test(verdict)) {
      return "Verdict must contain a supported status"
    }
    if (/\b(FAIL|BLOCKED)\b/.test(verdict)) return `Report verdict is ${verdict.match(/\b(FAIL|BLOCKED)\b/)[1]}`
  }
  return null
}

async function inspectArtifact(runDir, fileName) {
  const filePath = path.join(runDir, fileName)
  const issues = []
  if (!(await pathExists(filePath))) return { file: fileName, ok: false, issues: ["missing"] }

  const stat = await fs.stat(filePath)
  if (stat.size < 80) issues.push("too short to be credible")

  const content = await fs.readFile(filePath, "utf8")
  if (/\{\{[^}\n]+\}\}|\[TODO\]|\bTBD\b|<TBD>/i.test(content)) issues.push("contains unresolved placeholder")

  for (const heading of ARTIFACT_HEADINGS[fileName] || []) {
    if (!content.includes(heading)) issues.push(`missing heading: ${heading}`)
  }

  const verdictIssue = reportVerdictIssue(fileName, content)
  if (verdictIssue) issues.push(verdictIssue)

  return { file: fileName, ok: issues.length === 0, issues }
}

export const project_context = tool({
  description: "Return the authoritative OpenCode project root and diagnostics. Use this before any SDLC work; never use the provider bridge process cwd as repository root.",
  args: {},
  async execute(_args, context) {
    const root = projectRoot(context)
    let gitRoot = null
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: root,
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 256 * 1024,
      })
      gitRoot = String(stdout || "").trim() || null
    } catch {}
    const hasSdlc = await pathExists(path.join(root, ".sdlc"))
    const hasOpenCode = await pathExists(path.join(root, ".opencode"))
    return JSON.stringify({
      projectRoot: root,
      gitRoot,
      contextDirectory: context.directory || null,
      contextWorktree: context.worktree || null,
      providerProcessCwd: process.cwd(),
      hasSdlc,
      hasOpenCode,
      warning: path.resolve(process.cwd()) !== path.resolve(root)
        ? "Provider/plugin process cwd differs from projectRoot. Always use projectRoot."
        : null,
    }, null, 2)
  },
})

export const begin_stage = tool({
  description: "Persist a stage checkpoint before delegation. Prevents blind duplicate execution after timeouts.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    stageName: tool.schema.string().describe("Stage role name such as developer, reviewer or judge"),
  },
  async execute(args, context) {
    const stageName = assertSafeSegment(args.stageName, "stageName")
    const { runId, filePath, state } = await loadState(context, args.runId)
    state.stageExecutions = state.stageExecutions || {}
    const previous = state.stageExecutions[stageName]
    const artifacts = await existingStageArtifacts(context, runId, stageName)
    if (previous?.status === "COMPLETED") {
      return JSON.stringify({ runId, stageName, skip: true, reason: "already-completed", previous, artifacts }, null, 2)
    }
    const snapshot = await gitSnapshot(projectRoot(context))
    if (previous?.status === "IN_PROGRESS") {
      const changedSinceStart = previous.before?.hash && snapshot.hash && previous.before.hash !== snapshot.hash
      return JSON.stringify({
        runId,
        stageName,
        skip: true,
        recoveryRequired: true,
        reason: changedSinceStart || artifacts.found.length ? "prior-invocation-may-have-side-effects" : "prior-invocation-in-progress",
        previous,
        currentSnapshot: snapshot,
        artifacts,
      }, null, 2)
    }
    state.stageExecutions[stageName] = {
      status: "IN_PROGRESS",
      startedAt: now(),
      attempts: (previous?.attempts || 0) + 1,
      before: snapshot,
    }
    await saveState(filePath, state, "stage-begun", { stageName })
    return JSON.stringify({ runId, stageName, skip: false, projectRoot: projectRoot(context), before: snapshot, artifacts }, null, 2)
  },
})

export const recover_stage = tool({
  description: "Inspect a possibly timed-out stage before any retry. If worktree or artifacts changed, resume/validate instead of blindly re-executing.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    stageName: tool.schema.string().describe("Stage role name"),
  },
  async execute(args, context) {
    const stageName = assertSafeSegment(args.stageName, "stageName")
    const { runId, state } = await loadState(context, args.runId)
    const previous = state.stageExecutions?.[stageName] || null
    const current = await gitSnapshot(projectRoot(context))
    const artifacts = await existingStageArtifacts(context, runId, stageName)
    const changedSinceStart = Boolean(previous?.before?.hash && current.hash && previous.before.hash !== current.hash)
    const sideEffectsObserved = changedSinceStart || artifacts.found.length > 0
    return JSON.stringify({
      runId,
      stageName,
      projectRoot: projectRoot(context),
      previous,
      currentSnapshot: current,
      artifacts,
      sideEffectsObserved,
      recommendation: sideEffectsObserved
        ? "DO_NOT_BLIND_RETRY: inspect and validate existing result, then complete or repair only what is missing."
        : "No side effect detected. One deliberate re-execution is allowed if still required.",
    }, null, 2)
  },
})

export const complete_stage = tool({
  description: "Persist successful stage completion immediately after its artifact/output is validated.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    stageName: tool.schema.string().describe("Stage role name"),
    summary: tool.schema.string().describe("Concise completion evidence"),
  },
  async execute(args, context) {
    const stageName = assertSafeSegment(args.stageName, "stageName")
    const { runId, filePath, state } = await loadState(context, args.runId)
    state.stageExecutions = state.stageExecutions || {}
    const artifacts = await existingStageArtifacts(context, runId, stageName)
    const expectedMissing = artifacts.expected.filter((x) => !artifacts.found.includes(x))
    if (expectedMissing.length) {
      throw new Error(`Cannot complete ${stageName}: missing expected artifacts ${expectedMissing.join(", ")}`)
    }
    const previous = state.stageExecutions[stageName] || {}
    state.stageExecutions[stageName] = {
      ...previous,
      status: "COMPLETED",
      completedAt: now(),
      after: await gitSnapshot(projectRoot(context)),
      summary: String(args.summary || "").slice(0, 1000),
    }
    await saveState(filePath, state, "stage-completed", { stageName, summary: state.stageExecutions[stageName].summary })
    return JSON.stringify({ runId, stageName, completed: true, artifacts }, null, 2)
  },
})

export const create_run = tool({
  description: "Create a new persisted SDLC run, write the original request, state.json and set it as current. Use only for a new workflow.",
  args: {
    title: tool.schema.string().describe("Short descriptive title"),
    request: tool.schema.string().describe("Original request preserved verbatim"),
    riskHint: tool.schema.string().describe("Optional initial hint or UNCLASSIFIED"),
  },
  async execute(args, context) {
    if (!args.request.trim()) throw new Error("Request cannot be empty")
    const root = sdlcRoot(context)
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
    let runId = `${timestamp}-${slugify(args.title)}`
    let runDir = path.join(root, "runs", runId)
    if (await pathExists(runDir)) {
      runId = `${runId}-${crypto.randomBytes(2).toString("hex")}`
      runDir = path.join(root, "runs", runId)
    }
    await fs.mkdir(path.join(runDir, "evidence", "raw"), { recursive: true })

    const requestFile = `# Work Request\n\n- Run ID: ${runId}\n- Created: ${now()}\n- Initial risk hint: ${args.riskHint || "UNCLASSIFIED"}\n\n## Original Request\n\n${args.request.trim()}\n\n## Orchestrator Notes\n\nNo interpretation has been applied at intake.\n`
    await fs.writeFile(path.join(runDir, "00-request.md"), requestFile, "utf8")

    const state = {
      schemaVersion: 1,
      id: runId,
      title: args.title.trim(),
      projectRoot: projectRoot(context),
      stageExecutions: {},
      status: "ACTIVE",
      stage: "intake",
      riskLevel: "UNCLASSIFIED",
      requiredChecks: [],
      repairLoops: 0,
      maxRepairLoops: 2,
      gates: {},
      artifacts: ["00-request.md"],
      createdAt: now(),
      updatedAt: now(),
      history: [{ at: now(), event: "run-created", riskHint: args.riskHint || "UNCLASSIFIED" }],
    }
    await writeJsonAtomic(path.join(runDir, "state.json"), state)
    await writeJsonAtomic(path.join(root, "current-run.json"), { runId, updatedAt: now() })
    return JSON.stringify({ runId, runDir: path.relative(projectRoot(context), runDir), state }, null, 2)
  },
})

export const configure_run = tool({
  description: "Set risk level, required conditional checks and repair budget after requirements and risk assessment are complete.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    riskLevel: tool.schema.string().describe("LOW, MEDIUM, HIGH or CRITICAL"),
    requiredChecks: tool.schema.string().describe("Comma-separated checks from tests,review,security,performance,devops,docs,human-approval"),
    maxRepairLoops: tool.schema.number().describe("Maximum automatic repair cycles, normally 0-3"),
  },
  async execute(args, context) {
    const { filePath, state } = await loadState(context, args.runId)
    const risk = args.riskLevel.toUpperCase()
    if (!RISKS.includes(risk) || risk === "UNCLASSIFIED") throw new Error(`Unsupported risk level: ${args.riskLevel}`)
    if (!Number.isInteger(args.maxRepairLoops) || args.maxRepairLoops < 0 || args.maxRepairLoops > 10) {
      throw new Error("maxRepairLoops must be an integer from 0 to 10")
    }
    state.riskLevel = risk
    state.requiredChecks = parseCsv(args.requiredChecks, CHECKS)
    state.maxRepairLoops = args.maxRepairLoops
    await saveState(filePath, state, "run-configured", {
      riskLevel: risk,
      requiredChecks: state.requiredChecks,
      maxRepairLoops: state.maxRepairLoops,
    })
    return JSON.stringify({ runId: state.id, riskLevel: risk, requiredChecks: state.requiredChecks, maxRepairLoops: state.maxRepairLoops }, null, 2)
  },
})

export const advance_stage = tool({
  description: "Advance a run stage and register artifact filenames after a specialist completes work. This does not pass a gate.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    stage: tool.schema.string().describe("Target stage"),
    summary: tool.schema.string().describe("Short evidence-based transition summary"),
    artifacts: tool.schema.string().describe("Comma-separated artifact filenames, or empty string"),
  },
  async execute(args, context) {
    const { filePath, state } = await loadState(context, args.runId)
    if (!STAGES.includes(args.stage)) throw new Error(`Unsupported stage: ${args.stage}`)
    state.stage = args.stage
    state.artifacts = [...new Set([...(state.artifacts || []), ...parseCsv(args.artifacts)])]
    await saveState(filePath, state, "stage-advanced", { stage: args.stage, summary: args.summary, artifacts: parseCsv(args.artifacts) })
    return JSON.stringify({ runId: state.id, stage: state.stage, artifacts: state.artifacts }, null, 2)
  },
})

export const validate_gate = tool({
  description: "Validate required artifacts, headings, placeholders and report verdicts for an SDLC gate. Technical judgment is still required.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    gate: tool.schema.string().describe("intake, design, implementation, verification or final"),
  },
  async execute(args, context) {
    const { runId, state } = await loadState(context, args.runId)
    if (!GATES.includes(args.gate)) throw new Error(`Unsupported gate: ${args.gate}`)
    const files = [...BASE_GATE_FILES[args.gate]]
    if (args.gate === "verification") {
      for (const check of state.requiredChecks || []) {
        if (CHECK_FILES[check]) files.push(CHECK_FILES[check])
      }
    }
    const unique = [...new Set(files)]
    const results = []
    for (const fileName of unique) results.push(await inspectArtifact(runDirectory(context, runId), fileName))
    const issues = results.filter((result) => !result.ok)
    return JSON.stringify({ runId, gate: args.gate, valid: issues.length === 0, requiredFiles: unique, results, issues }, null, 2)
  },
})

export const record_gate = tool({
  description: "Persist PASS or FAIL for a gate after structural validation and specialist judgment.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    gate: tool.schema.string().describe("intake, design, implementation, verification or final"),
    result: tool.schema.string().describe("PASS or FAIL"),
    summary: tool.schema.string().describe("Concise evidence and blocker IDs"),
  },
  async execute(args, context) {
    const { filePath, state } = await loadState(context, args.runId)
    if (!GATES.includes(args.gate)) throw new Error(`Unsupported gate: ${args.gate}`)
    const result = args.result.toUpperCase()
    if (!['PASS', 'FAIL'].includes(result)) throw new Error("Gate result must be PASS or FAIL")
    state.gates = state.gates || {}
    state.gates[args.gate] = { result, summary: args.summary, at: now() }
    await saveState(filePath, state, "gate-recorded", { gate: args.gate, result, summary: args.summary })
    return JSON.stringify({ runId: state.id, gate: args.gate, result, gates: state.gates }, null, 2)
  },
})

export const begin_repair = tool({
  description: "Start one bounded repair cycle for a failed gate. Refuses when the configured repair budget is exhausted.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    failedGate: tool.schema.string().describe("Failed gate name"),
    owner: tool.schema.string().describe("Responsible agent role"),
    reason: tool.schema.string().describe("Finding IDs and root evidence"),
  },
  async execute(args, context) {
    const { filePath, state } = await loadState(context, args.runId)
    if ((state.repairLoops || 0) >= (state.maxRepairLoops || 0)) {
      return JSON.stringify({ allowed: false, runId: state.id, repairLoops: state.repairLoops, maxRepairLoops: state.maxRepairLoops, reason: "repair budget exhausted" }, null, 2)
    }
    state.repairLoops = (state.repairLoops || 0) + 1
    state.stage = "repair"
    await saveState(filePath, state, "repair-started", {
      cycle: state.repairLoops,
      failedGate: args.failedGate,
      owner: args.owner,
      reason: args.reason,
    })
    return JSON.stringify({ allowed: true, runId: state.id, cycle: state.repairLoops, remaining: state.maxRepairLoops - state.repairLoops, owner: args.owner }, null, 2)
  },
})

export const status = tool({
  description: "Read concise persisted status for the current or specified SDLC run, including artifacts and gates.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
  },
  async execute(args, context) {
    const { runId, state } = await loadState(context, args.runId)
    const runDir = runDirectory(context, runId)
    const expected = Object.keys(ARTIFACT_HEADINGS)
    const artifacts = []
    for (const fileName of ["00-request.md", ...expected]) {
      if (await pathExists(path.join(runDir, fileName))) artifacts.push(fileName)
    }
    let graph = null
    try {
      graph = await loadGraphState(runDir)
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
    return JSON.stringify({
      runId,
      status: state.status,
      stage: state.stage,
      riskLevel: state.riskLevel,
      requiredChecks: state.requiredChecks,
      gates: state.gates,
      repairLoops: state.repairLoops,
      maxRepairLoops: state.maxRepairLoops,
      artifacts,
      updatedAt: state.updatedAt,
      graph: graph && {
        status: graph.status,
        currentNode: graph.currentNode,
        previousNode: graph.previousNode,
        cycles: graph.cycles,
        limits: graph.limits,
        gates: graph.gates,
        activeAgent: graph.activeAgent,
        selectedModel: graph.selectedModel,
        updatedAt: graph.updatedAt,
      },
    }, null, 2)
  },
})

export const list_runs = tool({
  description: "List persisted SDLC runs with concise state. Use when the current pointer is missing or the user requests run history.",
  args: {},
  async execute(_args, context) {
    const runsRoot = path.join(sdlcRoot(context), "runs")
    if (!(await pathExists(runsRoot))) return "[]"
    const entries = await fs.readdir(runsRoot, { withFileTypes: true })
    const values = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const statePath = path.join(runsRoot, entry.name, "state.json")
      if (!(await pathExists(statePath))) continue
      try {
        const state = await readJson(statePath)
        values.push({ id: state.id, title: state.title, status: state.status, stage: state.stage, riskLevel: state.riskLevel, updatedAt: state.updatedAt })
      } catch {
        values.push({ id: entry.name, status: "INVALID_STATE" })
      }
    }
    values.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    return JSON.stringify(values.slice(0, 50), null, 2)
  },
})

export const record_human_approval = tool({
  description: "Record an explicit human APPROVED or REJECTED decision for a run that requires human-approval. Never infer approval from silence or prior context.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    decision: tool.schema.string().describe("APPROVED or REJECTED"),
    evidence: tool.schema.string().describe("Exact user decision and session context; do not include secrets"),
  },
  async execute(args, context) {
    const { filePath, state } = await loadState(context, args.runId)
    const decision = args.decision.toUpperCase()
    if (!["APPROVED", "REJECTED"].includes(decision)) throw new Error("Human decision must be APPROVED or REJECTED")
    if (!(state.requiredChecks || []).includes("human-approval")) {
      throw new Error("This run does not require a human approval check")
    }
    if (!args.evidence.trim()) throw new Error("Human approval evidence cannot be empty")
    state.humanApproval = { decision, evidence: args.evidence.trim(), at: now() }
    await saveState(filePath, state, "human-approval-recorded", { decision, evidence: args.evidence.trim() })
    return JSON.stringify({ runId: state.id, humanApproval: state.humanApproval }, null, 2)
  },
})

export const close_run = tool({
  description: "Close a run as APPROVED, BLOCKED or CANCELLED. APPROVED requires a passing final gate and an APPROVED judge artifact.",
  args: {
    runId: tool.schema.string().describe("Run ID or current"),
    outcome: tool.schema.string().describe("APPROVED, BLOCKED or CANCELLED"),
    summary: tool.schema.string().describe("Final evidence or exact blocker and human action"),
  },
  async execute(args, context) {
    const { runId, filePath, state } = await loadState(context, args.runId)
    const outcome = args.outcome.toUpperCase()
    if (!["APPROVED", "BLOCKED", "CANCELLED"].includes(outcome)) throw new Error("Unsupported outcome")
    if (outcome === "APPROVED") {
      if (state.gates?.final?.result !== "PASS") throw new Error("Cannot approve without final gate PASS")
      const judge = await inspectArtifact(runDirectory(context, runId), "14-judge-decision.md")
      if (!judge.ok) throw new Error(`Cannot approve: ${judge.issues.join("; ")}`)
      if ((state.requiredChecks || []).includes("human-approval") && state.humanApproval?.decision !== "APPROVED") {
        throw new Error("Cannot approve until an explicit human APPROVED decision is recorded")
      }
    }
    state.status = outcome
    state.stage = "complete"
    state.outcomeSummary = args.summary
    await saveState(filePath, state, "run-closed", { outcome, summary: args.summary })
    return JSON.stringify({ runId, outcome, summary: args.summary, completedAt: state.updatedAt }, null, 2)
  },
})

export const graph_start = tool({
  description: "Start deterministic Graph SDLC v1 for an eligible persisted run. It only selects the PLAN node; native OpenCode subagents execute every node.",
  args: {
    runId: tool.schema.string().describe("SDLC run ID or current"),
    deliveryMode: tool.schema.string().describe("Resolved delivery mode; Graph v1 is initially enabled only for configured modes"),
  },
  async execute(args, context) {
    const { runId } = await loadState(context, args.runId)
    const config = await graphConfiguration(context)
    if (!config.enabled) throw new Error("Graph SDLC is disabled by policy")
    if (!config.deliveryModes.includes(args.deliveryMode)) throw new Error(`Graph SDLC is not enabled for delivery mode ${args.deliveryMode}`)
    const runDir = runDirectory(context, runId)
    try {
      const existing = await loadGraphState(runDir)
      return JSON.stringify({ runId, resumed: true, status: existing.status, currentNode: existing.currentNode, activeAgent: existing.activeAgent, selectedModel: existing.selectedModel }, null, 2)
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
    const state = createGraphState({
      runId,
      deliveryMode: args.deliveryMode,
      limits: config,
      selections: await graphSelections(context),
    })
    await saveGraphState(runDir, state, state.history)
    return JSON.stringify({ runId, graphStatus: state.status, currentNode: state.currentNode, activeAgent: state.activeAgent, selectedModel: state.selectedModel, activity: "[Graph] START â†’ PLAN" }, null, 2)
  },
})

export const graph_node_started = tool({
  description: "Persist entry into the current deterministic Graph SDLC node before delegating its selected native subagent. Does not execute the agent.",
  args: { runId: tool.schema.string().describe("SDLC run ID or current") },
  async execute(args, context) {
    const runId = await resolveRunId(context, args.runId)
    const runDir = runDirectory(context, runId)
    const state = await loadGraphState(runDir)
    const before = state.history.length
    startNode(state)
    await saveGraphState(runDir, state, state.history.slice(before))
    return JSON.stringify({ runId, node: state.currentNode, agent: state.activeAgent, selectedModel: state.selectedModel, configuredModel: state.selections?.[state.currentNode]?.configuredModel || null, actualModel: null, activity: `[Node] ${state.currentNode}` }, null, 2)
  },
})

export const graph_node_result = tool({
  description: "Validate a specialist node result and apply the deterministic Graph SDLC transition. The caller cannot choose the next node.",
  args: {
    runId: tool.schema.string().describe("SDLC run ID or current"),
    node: tool.schema.string().describe("Current graph node"),
    status: tool.schema.string().describe("Contract status for this node"),
    summary: tool.schema.string().describe("Concise operational result, never chain-of-thought"),
    evidenceJson: tool.schema.string().optional().describe("Optional JSON array of evidence references or command results"),
    findingsJson: tool.schema.string().optional().describe("Optional JSON array of concrete findings passed to REPAIR"),
    failureClass: tool.schema.string().optional().describe("BUSINESS_FAILURE, TOOL_FAILURE, MODEL_FAILURE, VALIDATION_FAILURE, PERMISSION_FAILURE, TIMEOUT, or INTERRUPTED"),
    actualModel: tool.schema.string().optional().describe("Only bridge-observed model; leave absent when unverified"),
  },
  async execute(args, context) {
    const runId = await resolveRunId(context, args.runId)
    const runDir = runDirectory(context, runId)
    const state = await loadGraphState(runDir)
    const before = state.history.length
    const output = applyNodeResult(state, {
      node: args.node,
      status: args.status,
      summary: args.summary,
      evidence: parseOptionalJson(args.evidenceJson, "evidenceJson"),
      findings: parseOptionalJson(args.findingsJson, "findingsJson"),
      failureClass: args.failureClass,
    }, { actualModel: args.actualModel })
    await saveGraphState(runDir, state, state.history.slice(before))
    return JSON.stringify({
      runId,
      node: output.result.node,
      gate: state.gates,
      transition: output.transition,
      graphStatus: state.status,
      currentNode: state.currentNode,
      activeAgent: state.activeAgent,
      selectedModel: state.selectedModel,
      repairCycles: state.cycles.repair,
      reviewCycles: state.cycles.review,
      activity: `[Transition] ${output.result.node} â†’ ${state.currentNode}`,
    }, null, 2)
  },
})

export const graph_parse_node_result = tool({
  description: "Strictly parse a child agent's delimited SDLC node result. This only validates the child report; Graph SDLC still owns transitions.",
  args: {
    expectedNode: tool.schema.string().describe("Current graph node expected from the child"),
    childResponse: tool.schema.string().describe("Complete child response containing exactly one final <SDLC_NODE_RESULT> JSON envelope"),
  },
  async execute(args) {
    return JSON.stringify(parseNodeResult(args.childResponse, args.expectedNode), null, 2)
  },
})

export const graph_resume = tool({
  description: "Resume a persisted Graph SDLC run. A node left RUNNING is recorded as INTERRUPTED and retried only from the same pending node; completed nodes are not rerun.",
  args: { runId: tool.schema.string().describe("SDLC run ID or current") },
  async execute(args, context) {
    const runId = await resolveRunId(context, args.runId)
    const runDir = runDirectory(context, runId)
    const state = await loadGraphState(runDir)
    const before = state.history.length
    resumeGraph(state)
    await saveGraphState(runDir, state, state.history.slice(before))
    return JSON.stringify({ runId, graphStatus: state.status, currentNode: state.currentNode, activeAgent: state.activeAgent, selectedModel: state.selectedModel, activity: `[Graph] RESUMED â†’ ${state.currentNode}` }, null, 2)
  },
})

export const graph_technical_retry = tool({
  description: "Record a technical retry without consuming a functional repair cycle or changing the deterministic graph edge. Use only for observed provider/tool failures.",
  args: {
    runId: tool.schema.string().describe("SDLC run ID or current"),
    reason: tool.schema.string().describe("Observed provider/tool failure only; no private reasoning"),
    attempt: tool.schema.number().optional().describe("Technical retry attempt number"),
  },
  async execute(args, context) {
    const runId = await resolveRunId(context, args.runId)
    const runDir = runDirectory(context, runId)
    const state = await loadGraphState(runDir)
    const before = state.history.length
    recordTechnicalRetry(state, { reason: args.reason, attempt: args.attempt })
    await saveGraphState(runDir, state, state.history.slice(before))
    return JSON.stringify({ runId, node: state.currentNode, technicalRetries: state.cycles.technicalRetry, repairCycles: state.cycles.repair, activity: `[Retry] ${state.currentNode} attempt ${args.attempt || state.cycles.technicalRetry}` }, null, 2)
  },
})

export const graph_status = tool({
  description: "Read concise deterministic Graph SDLC state, gates, cycles, selected agents/models, and next node without running work.",
  args: { runId: tool.schema.string().describe("SDLC run ID or current") },
  async execute(args, context) {
    const runId = await resolveRunId(context, args.runId)
    const state = await loadGraphState(runDirectory(context, runId))
    return JSON.stringify({ runId, deliveryMode: state.deliveryMode, state: state.status, currentNode: state.currentNode, previousNode: state.previousNode, cycles: state.cycles, limits: state.limits, gates: state.gates, selections: state.selections, lastFailure: state.lastFailure, updatedAt: state.updatedAt }, null, 2)
  },
})

export const apply_models = tool({
  description: "Validate pinned AXET model references against `opencode models`, then keep agent frontmatter synchronized with backups. Strict mode blocks any provider fallback.",
  args: {},
  async execute(_args, context) {
    const root = projectRoot(context)
    const configPath = path.join(root, ".sdlc", "config", "models.json")
    const mapping = await readJson(configPath)
    const strictNoFallback = mapping._strictNoFallback === true
    const agentDir = path.join(root, ".opencode", "agents")
    const stamp = new Date().toISOString().replace(/[-:.]/g, "")
    const backupDir = path.join(root, ".sdlc", "backups", `models-${stamp}`)
    const changed = []
    const inherited = []
    const missingAgents = []
    const unresolved = []
    const ambiguous = []
    const resolved = []

    let availableModels = []
    try {
      const { stdout } = await execFileAsync(process.platform === "win32" ? "opencode.cmd" : "opencode", ["models"], {
        shell: process.platform === "win32",
        cwd: root,
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
      })
      availableModels = String(stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[^\s/]+\/.+/.test(line))
        .map((line) => line.split(/\s+/)[0])
    } catch (error) {
      throw new Error(`Unable to list OpenCode models automatically: ${error?.message || error}. Run 'opencode models' manually and verify providers are connected.`)
    }

    function resolveModelReference(rawModel, agentName) {
      const model = String(rawModel || "inherit").trim()
      if (model === "inherit") return { model, source: "inherit" }
      if (/^[^/\s]+\/[^\s]+$/.test(model)) {
        if (!availableModels.includes(model)) {
          unresolved.push({ agent: agentName, requested: model })
          return { model: null, source: "full-unavailable" }
        }
        return { model, source: "full" }
      }
      if (/\s/.test(model) || !model) {
        unresolved.push({ agent: agentName, requested: model })
        return { model: null, source: "invalid" }
      }
      const matches = availableModels.filter((full) => full.slice(full.indexOf("/") + 1) === model)
      if (matches.length === 1) return { model: matches[0], source: "auto" }
      if (matches.length === 0) {
        unresolved.push({ agent: agentName, requested: model })
        return { model: null, source: "missing" }
      }
      ambiguous.push({ agent: agentName, requested: model, matches })
      return { model: null, source: "ambiguous" }
    }

    const desired = []
    for (const [agentName, rawModel] of Object.entries(mapping)) {
      if (agentName.startsWith("_")) continue
      const resolution = resolveModelReference(rawModel, agentName)
      desired.push({ agentName, requested: String(rawModel || "inherit").trim(), ...resolution })
    }

    if (strictNoFallback && (unresolved.length || ambiguous.length)) {
      throw new Error(`Strict model routing blocked. Unresolved=${JSON.stringify(unresolved)} Ambiguous=${JSON.stringify(ambiguous)}. No fallback model was used.`)
    }

    for (const entry of desired) {
      const { agentName, model } = entry
      if (!model) continue
      const agentPath = path.join(agentDir, `${assertSafeSegment(agentName, "agent name")}.md`)
      if (!(await pathExists(agentPath))) {
        missingAgents.push(agentName)
        continue
      }
      const original = await fs.readFile(agentPath, "utf8")
      const match = original.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!match) throw new Error(`Agent frontmatter not found: ${agentName}`)
      let frontmatter = match[1]
      frontmatter = frontmatter.replace(/^model:\s*.*\r?\n?/m, "")
      if (model !== "inherit") {
        if (/^mode:\s*.*$/m.test(frontmatter)) {
          frontmatter = frontmatter.replace(/^(mode:\s*.*)$/m, `$1\nmodel: ${model}`)
        } else {
          frontmatter = `model: ${model}\n${frontmatter}`
        }
      }
      const updated = original.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${frontmatter.trimEnd()}\n---`)
      if (updated !== original) {
        await fs.mkdir(backupDir, { recursive: true })
        await fs.writeFile(path.join(backupDir, `${agentName}.md`), original, "utf8")
        await fs.writeFile(agentPath, updated, "utf8")
        changed.push({ agent: agentName, requested: entry.requested, model })
      }
      if (model === "inherit") inherited.push(agentName)
      else resolved.push({ agent: agentName, requested: entry.requested, model, source: entry.source })
    }

    return JSON.stringify({
      strictNoFallback,
      availableModelCount: availableModels.length,
      resolved,
      changed,
      inherited,
      unresolved,
      ambiguous,
      missingAgents,
      backupDir: changed.length ? path.relative(root, backupDir) : null,
    }, null, 2)
  },
})

export const resolve_model_routing = tool({
  description: "Classify a request into a delivery mode and execution capability profile using .sdlc/config/models.json. Records ORCHESTRATOR_DECISION when a run is supplied. This selects a native OpenCode subagent; it does not modify the bridge.",
  args: {
    request: tool.schema.string().describe("Original user request"),
    runId: tool.schema.string().optional().describe("SDLC run ID, when one exists"),
  },
  async execute(args, context) {
    const root = projectRoot(context)
    const mapping = await readJson(path.join(root, ".sdlc", "config", "models.json"))
    const classification = classifyRequest(args.request)
    const decision = buildRoutingDecision(classification, mapping._executionProfiles)
    const event = { event: "ORCHESTRATOR_DECISION", projectRoot: root, ...decision }
    if (args.runId) {
      const target = path.join(runDirectory(context, args.runId), "15-model-routing.jsonl")
      await fs.appendFile(target, `${JSON.stringify(event)}\n`, "utf8")
    }
    return JSON.stringify(event, null, 2)
  },
})

export const record_model_execution = tool({
  description: "Record the selected and OpenCode-configured model for a native V2 subagent delegation. actualModel is only populated from bridge evidence; configuration alone is never bridge proof.",
  args: {
    runId: tool.schema.string().describe("SDLC run ID"),
    requestedModel: tool.schema.string().describe("Model selected by the routing decision"),
    configuredModel: tool.schema.string().describe("Exact model resolved in OpenCode agent configuration"),
    actualModel: tool.schema.string().optional().describe("Model observed in bridge evidence, if available"),
    agent: tool.schema.string().describe("Native OpenCode V2 subagent agent ID"),
    phase: tool.schema.string().describe("Execution phase"),
  },
  async execute(args, context) {
    const reconciliation = reconcileModel({ selectedModel: args.requestedModel, configuredModel: args.configuredModel, actualModel: args.actualModel })
    const event = { event: "MODEL_EXECUTION_START", selectedModel: args.requestedModel, configuredModel: args.configuredModel, actualModel: args.actualModel || null, agent: args.agent, phase: args.phase, reconciliation }
    const target = path.join(runDirectory(context, args.runId), "15-model-routing.jsonl")
    await fs.appendFile(target, `${JSON.stringify(event)}\n`, "utf8")
    return JSON.stringify(event, null, 2)
  },
})

export const activity_event = tool({
  description: "Emit a concise operational activity item visible in OpenCode and persist it in the SDLC run. Never use it for chain-of-thought, prompts, secrets, or synthetic heartbeats.",
  args: {
    runId: tool.schema.string().describe("SDLC run ID"),
    event: tool.schema.string().describe("ORCHESTRATOR_DECISION, MODEL_SELECTED, MODEL_EXECUTION, MODEL_SWITCH, AGENT_DELEGATED, PHASE_STARTED, PHASE_COMPLETED, COMMAND_STARTED, COMMAND_COMPLETED, RETRY, FALLBACK, MODEL_ROUTING_WARNING, RUN_COMPLETED, or RUN_FAILED"),
    deliveryMode: tool.schema.string().optional(),
    executionProfile: tool.schema.string().optional(),
    phase: tool.schema.string().optional(),
    agent: tool.schema.string().optional(),
    selectedModel: tool.schema.string().optional(),
    configuredModel: tool.schema.string().optional(),
    actualModel: tool.schema.string().optional(),
    previousModel: tool.schema.string().optional(),
    reason: tool.schema.string().optional(),
    task: tool.schema.string().optional(),
    command: tool.schema.string().optional(),
    result: tool.schema.string().optional(),
    attempt: tool.schema.number().optional(),
    bridgeSessionId: tool.schema.string().optional(),
    requestId: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const level = String(process.env.ORCHESTRATOR_LOG_LEVEL || "normal").toLowerCase() === "debug" ? "debug" : "normal"
    const event = createActivityEvent({
      ...args,
      correlation: {
        bridgeSessionId: args.bridgeSessionId,
        requestId: args.requestId,
        orchestratorRunId: args.runId,
      },
    })
    const target = path.join(runDirectory(context, args.runId), "16-orchestrator-activity.jsonl")
    await fs.appendFile(target, `${JSON.stringify(event)}\n`, "utf8")
    return formatActivity(event, level)
  },
})
