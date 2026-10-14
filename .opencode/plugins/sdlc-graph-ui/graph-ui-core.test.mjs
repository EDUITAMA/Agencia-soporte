import test from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { readFileSync } from "node:fs"
import { activityEntry, createObserver, footerText, panelLines, toastForEvent } from "./graph-ui-core.mjs"

const state = (over = {}) => ({ runId: "r1", status: "RUNNING", currentNode: "PLAN", cycles: { repair: 0 }, limits: { maxRepairCycles: 3 }, gates: {}, updatedAt: "t", ...over })

test("observer shows live events of a new run and notifies terminal once", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gui-"))
  const dir = path.join(root, ".sdlc", "runs", "r1")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(root, ".sdlc", "current-run.json"), JSON.stringify({ runId: "r1" }))
  const toasts = [], footers = [], terminals = []
  const memo = {}
  const obs = createObserver(root, {
    onEvent: (ev, s) => { const t = toastForEvent(ev, s, memo); if (t) toasts.push(t.message) },
    onState: (s) => footers.push(footerText(s)),
    onTerminal: (s) => terminals.push(s.status),
  })
  await obs.tick() // run does not exist yet / empty history
  const write = async (s, events) => {
    await fs.writeFile(path.join(dir, "graph-state.json"), JSON.stringify(s))
    await fs.appendFile(path.join(dir, "graph-events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n")
    await obs.tick()
  }
  await write(state(), [{ event: "GRAPH_STARTED", to: "PLAN" }, { event: "NODE_ENTERED", node: "PLAN" }, { event: "NODE_ENTERED", node: "PLAN", agent: "sdlc-planner", selectedModel: "axet/gpt-5.6-terra" }])
  await write(state({ currentNode: "IMPLEMENT", gates: { plan: "PASS" } }), [{ event: "NODE_COMPLETED", node: "PLAN", status: "PASS" }, { event: "TRANSITION", from: "PLAN", to: "IMPLEMENT" }])
  await write(state({ currentNode: "REPAIR", cycles: { repair: 1 } }), [{ event: "REPAIR_SCHEDULED", from: "TEST", repairCycle: 1 }])
  await write(state({ status: "COMPLETE", currentNode: "COMPLETE", updatedAt: "t2" }), [{ event: "TRANSITION", from: "REVIEW", to: "COMPLETE" }])
  await obs.tick()
  assert.deepEqual(toasts, [
    "Graph started · PLAN",
    "PLAN started · sdlc-planner · gpt-5.6-terra",
    "PLAN PASS → IMPLEMENT",
    "TEST FAILED → REPAIR 1/3",
    "REVIEW → COMPLETE",
  ])
  assert.deepEqual(footers, ["Graph: PLAN · RUNNING", "Graph: IMPLEMENT · RUNNING", "Graph: REPAIR 1/3", "Graph: COMPLETE"])
  assert.deepEqual(terminals, ["COMPLETE"])
})

test("history present at startup is not replayed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gui-"))
  const dir = path.join(root, ".sdlc", "runs", "old")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "graph-state.json"), JSON.stringify(state({ status: "FAILED" })))
  await fs.writeFile(path.join(dir, "graph-events.jsonl"), JSON.stringify({ event: "GRAPH_FAILED" }) + "\n")
  const seen = []
  await createObserver(root, { onEvent: (e) => seen.push(e), onState: () => {}, onTerminal: (s) => seen.push("T") }).tick()
  assert.deepEqual(seen, [])
})

test("UI sources never use session prompt/synthetic/command", () => {
  for (const f of ["tui.tsx", "graph-ui-core.mjs", "index.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8")
    assert.doesNotMatch(src, /session\s*\.\s*(prompt|synthetic|command)|\.prompt\(|promptAsync/)
  }
})

test("stale RUNNING run is flagged", () => {
  const old = state({ updatedAt: new Date(Date.now() - 20 * 60000).toISOString() })
  assert.match(footerText(old), /STALE/)
  assert.equal(footerText(state({ updatedAt: new Date().toISOString() })), "Graph: PLAN · RUNNING")
})

test("activity log, elapsed time and host toasts", () => {
  const t0 = Date.parse("2026-01-01T00:00:00Z")
  const log = [
    { event: "NODE_ENTERED", node: "TEST", agent: "sdlc-test-engineer", selectedModel: "axet/gpt-5.4", at: "2026-01-01T00:00:00.000Z" },
    { event: "HOST_WORKSPACE_ACTIONS_APPLIED", node: "TEST", at: "2026-01-01T00:00:40.000Z", actions: [{ type: "HOST_TEST_COMMAND", command: "node", args: ["--test"], exitCode: 0 }] },
    { event: "HOST_WORKSPACE_ACTIONS_APPLIED", node: "IMPLEMENT", at: "2026-01-01T00:00:41.000Z", actions: [{ type: "HOST_WRITE_FILE", path: "a.txt" }, { type: "HOST_DELETE_FILE", path: "b.txt" }] },
  ].map(activityEntry)
  assert.match(log[1].text, /node --test .* exit 0/)
  assert.match(log[2].text, /escribio a\.txt|escribi. a\.txt/)
  assert.match(footerText(state({ currentNode: "TEST", updatedAt: new Date(t0 + 70000).toISOString() }), t0 + 72000, log), /TEST . RUNNING . 1m12s/)
  assert.ok(panelLines(state({ currentNode: "TEST" }), log, t0 + 72000).some((l) => /Actividad/.test(l)))
  assert.equal(toastForEvent({ event: "HOST_WORKSPACE_ACTIONS_APPLIED", node: "TEST", actions: [{ type: "HOST_TEST_COMMAND", exitCode: 1 }] }, state()).variant, "warning")
  assert.match(toastForEvent({ event: "HOST_WORKSPACE_ACTIONS_APPLIED", node: "IMPLEMENT", actions: [{ type: "HOST_WRITE_FILE" }] }, state()).message, /1 escritos/)
})