// Pure, read-only observer for Graph SDLC operational artifacts.
// It never talks to a session or provider: it only reads .sdlc/runs/<runId>/graph-*.
import { promises as fs } from "node:fs"
import path from "node:path"

const RUN_ID = /^[A-Za-z0-9._-]+$/
const TERMINAL = new Set(["COMPLETE", "COMPLETED", "FAILED", "BLOCKED"])
const NODES = ["PLAN", "IMPLEMENT", "TEST", "REVIEW"]

const readJson = async (file) => {
  try { return JSON.parse(await fs.readFile(file, "utf8")) } catch { return undefined }
}

export async function resolveRunDir(root) {
  const runs = path.join(root, ".sdlc", "runs")
  const pointer = await readJson(path.join(root, ".sdlc", "current-run.json"))
  if (pointer?.runId && RUN_ID.test(pointer.runId)) return path.join(runs, pointer.runId)
  try {
    const entries = (await fs.readdir(runs, { withFileTypes: true })).filter((e) => e.isDirectory() && RUN_ID.test(e.name))
    return entries.length ? path.join(runs, entries.map((e) => e.name).sort().at(-1)) : undefined
  } catch { return undefined }
}

const short = (model) => String(model ?? "").replace(/^axet\//, "")
const gate = (state, node) => {
  const g = state?.gates?.[node === "IMPLEMENT" ? "implementation" : node.toLowerCase()]
  return g ?? "PENDING"
}

// Maps one graph-events.jsonl record to a toast, or undefined when not significant.
export function toastForEvent(ev, state, memo = {}) {
  const max = state?.limits?.maxRepairCycles ?? 3
  switch (ev.event) {
    case "GRAPH_STARTED":
      return { message: `Graph started · ${ev.to ?? "PLAN"}`, variant: "info" }
    case "NODE_ENTERED": // NODE_STARTED: only the record that carries agent/model
      if (!ev.agent) return undefined
      return { message: `${ev.node} started · ${ev.agent} · ${short(ev.selectedModel)}`, variant: "info" }
    case "NODE_COMPLETED":
      memo[ev.node] = ev.status // a following TRANSITION reports the outcome; avoid a duplicate toast on PASS
      return ev.status === "PASS" ? undefined : { message: `${ev.node} ${ev.status}`, variant: "warning" }
    case "TRANSITION":
      return { message: `${ev.from}${memo[ev.from] ? ` ${memo[ev.from]}` : ""} → ${ev.to}`, variant: ev.to === "COMPLETE" ? "success" : "info" }
    case "REPAIR_SCHEDULED":
      return { message: `${ev.from} FAILED → REPAIR ${ev.repairCycle}/${max}`, variant: "warning" }
    case "TECHNICAL_RETRY_SCHEDULED":
      return { message: `${ev.node} technical retry · ${ev.failureClass ?? ev.reason ?? ""}`, variant: "warning" }
    case "HOST_WORKSPACE_ACTIONS_APPLIED": {
      const actions = ev.actions ?? []
      const test = actions.find((a) => a.type === "HOST_TEST_COMMAND")
      if (test) return { message: `${ev.node} test exit ${test.exitCode}`, variant: test.exitCode === 0 ? "success" : "warning" }
      const written = actions.filter((a) => a.type === "HOST_WRITE_FILE").length
      const deleted = actions.filter((a) => a.type === "HOST_DELETE_FILE").length
      return { message: `${ev.node} host: ${written} escritos${deleted ? `, ${deleted} borrados` : ""}`, variant: "info" }
    }
    case "GRAPH_COMPLETED":
      return { message: "COMPLETE", variant: "success" }
    case "GRAPH_FAILED":
      return { message: `FAILED${ev.reason ? ` · ${ev.reason}` : ""}`, variant: "error" }
    case "GRAPH_BLOCKED":
      return { message: `BLOCKED${ev.reason ? ` · ${ev.reason}` : ""}`, variant: "error" }
    default:
      return undefined
  }
}

const STALE_MS = 15 * 60 * 1000
export const isStale = (state, now = Date.now()) =>
  Boolean(state) && !TERMINAL.has(state.status) && state.currentNode !== "COMPLETE" &&
  Number.isFinite(Date.parse(state.updatedAt)) && now - Date.parse(state.updatedAt) > STALE_MS

export function footerText(state, now = Date.now(), activity = []) {
  if (!state) return ""
  const node = state.currentNode ?? "?"
  const max = state.limits?.maxRepairCycles ?? 3
  if (isStale(state, now)) return `Graph: ${node} · STALE (sin actividad)`
  if (TERMINAL.has(state.status)) return `Graph: ${node === "COMPLETE" ? "COMPLETE" : `${node} · ${state.status}`}`
  const time = elapsed(activity, now)
  if (node === "REPAIR") return `Graph: REPAIR ${state.cycles?.repair ?? 0}/${max}${time ? ` · ${time}` : ""}`
  return `Graph: ${node} · ${state.status ?? "RUNNING"}${time ? ` · ${time}` : ""}`
}

export function panelLines(state, activity = [], now = Date.now()) {
  if (!state) return []
  const max = state.limits?.maxRepairCycles ?? 3
  const lines = [`Run: ${state.runId}`, `Status: ${state.status}`, ""]
  for (const n of NODES) {
    const g = gate(state, n)
    const running = state.currentNode === n && !TERMINAL.has(state.status)
    lines.push(`${n.padEnd(10)}${running ? `RUNNING ${elapsed(activity, now)}`.trim() : g}`)
  }
  lines.push("", `Repair: ${state.cycles?.repair ?? 0}/${max}`)
  if (activity.length) lines.push("", "Actividad:", ...activity.slice(-14).map((a) => `${a.at.slice(11, 19)} ${a.text}`))
  return lines
}

const clip = (text, n = 90) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

// Human readable activity line for the panel log; undefined for noise.
export function describeEvent(ev) {
  switch (ev.event) {
    case "GRAPH_STARTED": return "Graph iniciado"
    case "NODE_ENTERED": return ev.agent ? `${ev.node} inicia · ${ev.agent} · ${short(ev.selectedModel)}` : undefined
    case "NODE_COMPLETED": return `${ev.node} ${ev.status}${ev.summary ? ` — ${clip(String(ev.summary))}` : ""}`
    case "HOST_WORKSPACE_ACTIONS_APPLIED":
      return `${ev.node} host: ` + (ev.actions ?? []).map((a) =>
        a.type === "HOST_WRITE_FILE" ? `escribió ${a.path}` :
        a.type === "HOST_DELETE_FILE" ? `borró ${a.path}` :
        a.type === "HOST_TEST_COMMAND" ? `${a.command} ${(a.args ?? []).join(" ")} → exit ${a.exitCode}` : a.type).join("; ")
    case "TRANSITION": return `${ev.from} → ${ev.to} (${ev.reason})`
    case "REPAIR_SCHEDULED": return `REPAIR ${ev.repairCycle} programado`
    case "TECHNICAL_RETRY_SCHEDULED": return `${ev.node} reintento técnico: ${clip(String(ev.reason ?? ""))}`
    case "TECHNICAL_RETRY_EXHAUSTED": return `${ev.node} reintentos agotados`
    case "GRAPH_FAILED": case "GRAPH_BLOCKED": return `${ev.event === "GRAPH_FAILED" ? "FALLÓ" : "BLOQUEADO"}: ${ev.reason ?? ""}`
    default: return undefined
  }
}

// Time since the last node start recorded in the activity log.
export function elapsed(activity, now = Date.now()) {
  const last = [...activity].reverse().find((a) => a.starts)
  if (!last) return ""
  const s = Math.max(0, Math.floor((now - Date.parse(last.at)) / 1000))
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
}

export const activityEntry = (ev) => {
  const text = describeEvent(ev)
  return text ? { at: String(ev.at ?? ""), text, starts: ev.event === "NODE_ENTERED" && Boolean(ev.agent) } : undefined
}

export function isTerminal(state) {
  return Boolean(state) && (TERMINAL.has(state.status) || state.currentNode === "COMPLETE")
}

// Incremental reader. History present at TUI start is skipped; runs that appear
// afterwards are replayed from byte 0 so no event is lost.
export function createObserver(root, { onEvent, onState, onTerminal, onHistory, onRunChange }) {
  let runDir, offset = 0, lastRaw = "", terminalSeen = false, started = false, busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const dir = await resolveRunDir(root)
      if (!dir) return
      const eventsFile = path.join(dir, "graph-events.jsonl")
      const state = await readJson(path.join(dir, "graph-state.json"))
      if (dir !== runDir) {
        const size = await fs.stat(eventsFile).then((s) => s.size).catch(() => 0)
        const skipHistory = !started
        offset = skipHistory ? size : 0
        terminalSeen = skipHistory && isTerminal(state)
        lastRaw = ""
        runDir = dir
        started = true
        onRunChange?.()
        if (skipHistory && onHistory) {
          const text = await fs.readFile(eventsFile, "utf8").catch(() => "")
          const past = []
          for (const line of text.split("\n")) { if (line.trim()) try { past.push(JSON.parse(line)) } catch { /* malformed */ } }
          onHistory(past.slice(-60))
        }
      }
      let handle
      try {
        handle = await fs.open(eventsFile, "r")
        const { size } = await handle.stat()
        if (size < offset) offset = 0
        if (size > offset) {
          const buf = Buffer.alloc(size - offset)
          await handle.read(buf, 0, buf.length, offset)
          const text = buf.toString("utf8")
          const complete = text.slice(0, text.lastIndexOf("\n") + 1)
          offset += Buffer.byteLength(complete, "utf8")
          for (const line of complete.split("\n")) {
            if (!line.trim()) continue
            try { onEvent(JSON.parse(line), state) } catch { /* malformed line */ }
          }
        }
      } catch { /* events file not created yet */ } finally { await handle?.close() }
      if (state) {
        const raw = JSON.stringify([state.status, state.currentNode, state.cycles, state.gates])
        if (raw !== lastRaw) { lastRaw = raw; onState(state) }
        const terminal = isTerminal(state)
        if (terminal && !terminalSeen) onTerminal(state)
        terminalSeen = terminal
      }
    } finally { busy = false }
  }
  return { tick }
}
