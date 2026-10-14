import { promises as fs } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
const execFileAsync = promisify(execFile)

function safeRelativePath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Host writeFile requires a non-empty path")
  const normalized = value.replace(/\\/g, "/")
  if (path.isAbsolute(value) || normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") throw new Error(`Host writeFile path escapes workspace: ${value}`)
  if (/(^|\/)\.env(?:\.|$)/i.test(normalized)) throw new Error("Host writeFile refuses environment files")
  return normalized
}

// An absolute path is accepted only when it resolves inside the workspace; it is then made relative.
function withinWorkspace(value, workspace) {
  if (!workspace || typeof value !== "string" || !path.isAbsolute(value)) return value
  const root = path.resolve(workspace)
  const relative = path.relative(root, path.resolve(value))
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.replace(/\\/g, "/") : value
}

export function validateWorkspaceActions(operations, { node, workspace }) {
  if (!Array.isArray(operations)) throw new Error("Host workspace operations must be an array")
  if (!["IMPLEMENT", "REPAIR", "TEST"].includes(node) && operations.length) throw new Error(`${node} may not request workspace mutations`)
  return operations.map((operation) => {
    if (!operation) throw new Error("Host workspace action is required")
    if (operation.type === "writeFile") {
      if (node === "TEST") throw new Error("TEST may not request workspace mutations")
      if (typeof operation.content !== "string") throw new Error("Host writeFile requires string content")
      return { type: "writeFile", path: safeRelativePath(withinWorkspace(operation.path, workspace)), content: operation.content }
    }
    if (operation.type === "deleteFile") {
      if (node === "TEST") throw new Error("TEST may not request workspace mutations")
      return { type: "deleteFile", path: safeRelativePath(withinWorkspace(operation.path, workspace)) }
    }
    if (operation.type === "runTest") {
      if (node !== "TEST") throw new Error("runTest is available only to TEST")
      if (Array.isArray(operation.args) && ['powershell.exe', 'pwsh'].includes(operation.command)) {
        // Harmless launcher flags are dropped; -ExecutionPolicy is deliberately not accepted.
        const args = operation.args.filter((arg) => !/^-(NoProfile|NonInteractive|NoLogo)$/i.test(arg))
        operation = { ...operation, args: args.map((arg, index) => (index > 0 && /^-File$/i.test(args[0]) ? withinWorkspace(arg, workspace) : arg)) }
        if (/^-File$/i.test(operation.args[0])) operation.args[0] = "-File"
      }
      const shown = JSON.stringify({ command: operation.command, args: operation.args })
      if (!['npm', 'pnpm', 'yarn', 'node', 'npx', 'powershell.exe', 'pwsh'].includes(operation.command) || !Array.isArray(operation.args) || operation.args.some((arg) => typeof arg !== 'string')) throw new Error(`Invalid host test command: ${shown}`)
      const powershell = ['powershell.exe', 'pwsh'].includes(operation.command)
      if (powershell && !(operation.args.length === 2 && operation.args[0] === '-File' && !path.isAbsolute(operation.args[1]) && !operation.args[1].includes('..'))) throw new Error(`Host PowerShell tests require exactly -File <relative script path>: ${shown}`)
      if (!powershell && !operation.args.some((arg) => /test|spec|check|lint/i.test(arg))) throw new Error(`Host runTest requires a test-like command: ${shown}`)
      return { type: "runTest", command: operation.command, args: operation.args, cwd: operation.cwd ? safeRelativePath(operation.cwd) : "." }
    }
    throw new Error("Host Workspace Actions supports only writeFile, deleteFile and runTest")
  })
}

export async function applyWorkspaceActions(operations, { workspace, node }) {
  const actions = validateWorkspaceActions(operations, { node, workspace })
  const root = path.resolve(workspace)
  const evidence = [], failures = []
  for (const action of actions) {
    if (action.type === "runTest") {
      const cwd = path.resolve(root, action.cwd)
      if (!cwd.startsWith(root)) throw new Error(`Host runTest cwd escapes workspace: ${action.cwd}`)
      try {
        const { stdout, stderr } = await execFileAsync(action.command, action.args, { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 128 * 1024 })
        evidence.push({ type: "HOST_TEST_COMMAND", command: action.command, args: action.args, cwd: action.cwd, exitCode: 0, output: `${stdout || ""}${stderr || ""}`.slice(-4000) })
      } catch (error) {
        const exitCode = Number.isInteger(error?.code) ? error.code : 1
        const output = `${error?.stdout || ""}${error?.stderr || ""}`.slice(-4000)
        evidence.push({ type: "HOST_TEST_COMMAND", command: action.command, args: action.args, cwd: action.cwd, exitCode, output })
        failures.push({ command: action.command, args: action.args, exitCode, output })
      }
      continue
    }
    const target = path.resolve(root, action.path)
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Host ${action.type} path escapes workspace: ${action.path}`)
    if (action.type === "deleteFile") {
      await fs.rm(target, { force: true })
      evidence.push({ type: "HOST_DELETE_FILE", path: action.path })
      continue
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.sdlc-host.tmp`
    await fs.writeFile(temporary, action.content, "utf8")
    await fs.rename(temporary, target)
    evidence.push({ type: "HOST_WRITE_FILE", path: action.path, bytes: Buffer.byteLength(action.content, "utf8") })
  }
  return { evidence, failures }
}
