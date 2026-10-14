import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const plugin = await readFile(new URL("./sdlc-tools-v2.mjs", import.meta.url), "utf8")
const config = await readFile(new URL("../../opencode.jsonc", import.meta.url), "utf8")
const smoke = await readFile(new URL("../commands/sdlc-plugin-smoke.md", import.meta.url), "utf8")
const entrypoint = await readFile(new URL("./sdlc-tools-v2/index.js", import.meta.url), "utf8")
const orchestrator = await readFile(new URL("../agents/sdlc-orchestrator.md", import.meta.url), "utf8")
const required = [
  "sdlc_project_context", "sdlc_create_run",
  "sdlc_graph_start", "sdlc_graph_node_started", "sdlc_graph_parse_node_result",
  "sdlc_graph_node_result", "sdlc_graph_resume", "sdlc_graph_technical_retry", "sdlc_graph_status",
]

assert.match(plugin, /export default \{/)
assert.match(plugin, /id:\s*"sdlc\.tools\.v2"/)
assert.match(plugin, /SDLC V2 tool registration did not produce sdlc_graph_start/)
assert.match(plugin, /ctx\.tool\.transform/)
assert.match(plugin, /ctx\.command\.transform/)
assert.match(plugin, /name: "sdlc-graph"/)
assert.match(plugin, /name: "sdlc-graph-host-smoke"/)
assert.match(plugin, /options: \{ codemode: false \}/)
assert.match(plugin, /executeSdlcV2/)
assert.doesNotMatch(plugin, /graph-engine\.mjs|transitions\.mjs|state-store\.mjs|node-result\.mjs/)
for (const name of required) assert.match(plugin, new RegExp(`${name}:`), `${name} is not registered`)
assert.match(plugin, /sdlc_plugin_status:/)
assert.match(plugin, /nativeSubagentAvailable/)
assert.match(plugin, /nativeDelegationToolIds/)
assert.match(plugin, /assertController/)
assert.match(smoke, /Call `sdlc_plugin_status` only/)
assert.match(smoke, /Do not search MCP resources or marketplace/i)
assert.match(entrypoint, /from "\.\.\/sdlc-tools-v2\.mjs"/)
assert.match(orchestrator, /Do not invoke a `skill` tool as a prerequisite/)
assert.match(orchestrator, /successful invocation of any `sdlc_\*` controller tool is conclusive evidence/)
assert.match(config, /"sdlc-orchestrator"\s*:\s*\{[\s\S]*?"action"\s*:\s*"sdlc_\*"/)
assert.match(config, /"sdlc-orchestrator"\s*:\s*\{[\s\S]*?"action"\s*:\s*"subagent"[\s\S]*?"resource"\s*:\s*"sdlc-\*"[\s\S]*?"effect"\s*:\s*"allow"/)
assert.match(config, /"sdlc-orchestrator"\s*:\s*\{[\s\S]*?"action"\s*:\s*"execute"[\s\S]*?"resource"\s*:\s*"\*"[\s\S]*?"effect"\s*:\s*"allow"/)
assert.doesNotMatch(config, /"plugin"\s*:/, "legacy singular plugin key must not be used")
assert.match(config, /"plugins"\s*:\s*\[\s*"\.\/\.opencode\/plugins\/sdlc-tools-v2"\s*,\s*"\.\/\.opencode\/plugins\/sdlc-graph-ui"\s*\]/s)
console.log("OpenCode V2 SDLC plugin registration: PASS")
