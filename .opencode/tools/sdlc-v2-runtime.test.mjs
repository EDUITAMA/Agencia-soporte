import assert from "node:assert/strict"
import { executeSdlcV2 } from "./sdlc-v2-runtime.mjs"

const context = { directory: process.cwd(), worktree: process.cwd() }
const project = await executeSdlcV2("project_context", {}, context)
assert.equal(project.projectRoot, process.cwd())
assert.equal(project.hasSdlc, true)
assert.equal(project.hasOpenCode, true)

const result = await executeSdlcV2("graph_parse_node_result", {
  expectedNode: "PLAN",
  childResponse: '<SDLC_NODE_RESULT>{"node":"PLAN","status":"PASS","summary":"plan ready","evidence":[],"findings":[]}</SDLC_NODE_RESULT>',
}, context)
assert.equal(result.node, "PLAN")
assert.equal(result.status, "PASS")

await assert.rejects(
  () => executeSdlcV2("begin_stage", {}, context),
  /do not silently fall back to the V1 runtime/,
)
console.log("SDLC V2 runtime handlers: PASS")
