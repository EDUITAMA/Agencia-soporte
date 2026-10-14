import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..", "..")
const agents = ["sdlc-planner", "sdlc-developer", "sdlc-test-engineer", "sdlc-reviewer"]

for (const agent of agents) {
  const text = await readFile(path.join(root, ".opencode", "agents", `${agent}.md`), "utf8")
  assert.match(text, /## Graph node boundary/)
  assert.match(text, /<SDLC_NODE_RESULT>/)
  assert.match(text, /Do not look for or call `sdlc_\*` tools/)
  assert.match(text, /do not invoke subagents/i)
  assert.match(text, /do not read or write `graph-state\.json`/)
  assert.match(text, /not because graph tools or subagents are unavailable/i)
  assert.doesNotMatch(text, /call `sdlc_activity_event`/)
}

const orchestrator = await readFile(path.join(root, ".opencode", "agents", "sdlc-orchestrator.md"), "utf8")
assert.match(orchestrator, /sdlc_graph_parse_node_result/)
assert.match(orchestrator, /Never infer PASS\/FAIL from prose/)
console.log("graph node-agent contract regression: 6 passed")
