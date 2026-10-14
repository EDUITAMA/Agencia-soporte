#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const errors = []
const warnings = []

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

async function requireFile(relative) {
  const absolute = path.join(root, relative)
  if (!(await exists(absolute))) errors.push(`Missing required file: ${relative}`)
  return absolute
}

function frontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return match ? match[1] : null
}

await requireFile("AGENTS.md")
await requireFile(".opencode/tools/sdlc.js")
await requireFile(".sdlc/config/policy.json")
await requireFile(".sdlc/config/models.json")
await requireFile(".sdlc/schemas/state.schema.json")

for (const relative of [
  ".sdlc/config/policy.json",
  ".sdlc/config/models.json",
  ".sdlc/config/stack-overrides.json",
  ".sdlc/schemas/state.schema.json",
  ".sdlc/schemas/models.schema.json",
]) {
  const file = path.join(root, relative)
  if (!(await exists(file))) continue
  try {
    JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    errors.push(`Invalid JSON ${relative}: ${error.message}`)
  }
}

const agentsDir = path.join(root, ".opencode", "agents")
if (await exists(agentsDir)) {
  const files = (await readdir(agentsDir)).filter((file) => file.endsWith(".md"))
  if (!files.includes("sdlc-orchestrator.md")) errors.push("Missing sdlc-orchestrator.md")
  if (!files.includes("sdlc-judge.md")) errors.push("Missing sdlc-judge.md")
  for (const file of files) {
    const content = await readFile(path.join(agentsDir, file), "utf8")
    const fm = frontmatter(content)
    if (!fm) {
      errors.push(`Missing frontmatter: .opencode/agents/${file}`)
      continue
    }
    if (!/^description:\s*.+/m.test(fm)) errors.push(`Missing description: .opencode/agents/${file}`)
    if (!/^mode:\s*(primary|subagent|all)\s*$/m.test(fm)) errors.push(`Invalid mode: .opencode/agents/${file}`)
  }
} else {
  errors.push("Missing .opencode/agents directory")
}

const commandsDir = path.join(root, ".opencode", "commands")
if (await exists(commandsDir)) {
  const files = (await readdir(commandsDir)).filter((file) => file.endsWith(".md"))
  for (const required of ["sdlc-start.md", "sdlc-resume.md", "sdlc-status.md", "sdlc-models.md"]) {
    if (!files.includes(required)) errors.push(`Missing command: ${required}`)
  }
  for (const file of files) {
    const content = await readFile(path.join(commandsDir, file), "utf8")
    const fm = frontmatter(content)
    if (!fm || !/^description:\s*.+/m.test(fm)) errors.push(`Invalid command frontmatter: ${file}`)
  }
} else {
  errors.push("Missing .opencode/commands directory")
}

const skillsDir = path.join(root, ".opencode", "skills")
if (await exists(skillsDir)) {
  const entries = await readdir(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillFile = path.join(skillsDir, entry.name, "SKILL.md")
    if (!(await exists(skillFile))) {
      errors.push(`Missing SKILL.md in ${entry.name}`)
      continue
    }
    const content = await readFile(skillFile, "utf8")
    const fm = frontmatter(content)
    const name = fm?.match(/^name:\s*(.+)\s*$/m)?.[1]?.trim()
    if (name !== entry.name) errors.push(`Skill name mismatch: folder=${entry.name}, frontmatter=${name || "missing"}`)
  }
} else {
  errors.push("Missing .opencode/skills directory")
}

const models = JSON.parse(await readFile(path.join(root, ".sdlc", "config", "models.json"), "utf8"))
for (const [role, model] of Object.entries(models)) {
  if (role.startsWith("_")) continue
  if (model !== "inherit" && !/^\S+$/.test(model)) errors.push(`Invalid model mapping: ${role}=${model}`)
  if (!(await exists(path.join(agentsDir, `${role}.md`)))) warnings.push(`Model mapping has no matching agent: ${role}`)
}

if (errors.length) {
  console.error("OpenCode SDLC installation validation FAILED")
  for (const error of errors) console.error(`- ${error}`)
  if (warnings.length) for (const warning of warnings) console.error(`- warning: ${warning}`)
  process.exit(1)
}

console.log("OpenCode SDLC installation validation PASSED")
console.log(`Agents: ${(await readdir(agentsDir)).filter((file) => file.endsWith(".md")).length}`)
console.log(`Commands: ${(await readdir(commandsDir)).filter((file) => file.endsWith(".md")).length}`)
console.log(`Skills: ${(await readdir(skillsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length}`)
for (const warning of warnings) console.log(`Warning: ${warning}`)
