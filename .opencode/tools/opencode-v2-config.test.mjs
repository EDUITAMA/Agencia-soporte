import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"

const root = new URL("../../", import.meta.url)
const read = (relative) => readFile(new URL(relative, root), "utf8")
const config = await read("opencode.jsonc")
const orchestrator = await read(".opencode/agents/sdlc-orchestrator.md")
const developer = await read(".opencode/agents/sdlc-developer.md")
const smoke = await read(".opencode/commands/sdlc-delegation-smoke.md")

assert.match(config, /"agents"\s*:/, "V2 requires the plural agents configuration key")
assert.doesNotMatch(config, /\n\s*"agent"\s*:/, "legacy V1 agent configuration key must not remain")
assert.match(config, /"permissions"\s*:\s*\[\s*\{\s*"action"\s*:\s*"subagent"\s*,\s*"resource"\s*:\s*"\*"\s*,\s*"effect"\s*:\s*"deny"/s)
assert.match(orchestrator, /^mode:\s*primary$/m)
assert.match(orchestrator, /^model:\s*axet\/gpt-5\.6-terra$/m)
assert.match(config, /"sdlc-orchestrator"\s*:\s*\{\s*"model"\s*:\s*"axet\/gpt-5\.6-terra"/)
assert.match(orchestrator, /^permissions:/m)
assert.doesNotMatch(orchestrator, /^permission:/m)
assert.match(orchestrator, /action:\s*subagent\s*\n\s*resource:\s*"\*"\s*\n\s*effect:\s*deny/)
assert.match(orchestrator, /action:\s*subagent\s*\n\s*resource:\s*"sdlc-\*"\s*\n\s*effect:\s*allow/)
assert.match(orchestrator, /action:\s*execute\s*\n\s*resource:\s*"\*"\s*\n\s*effect:\s*allow/)
assert.match(orchestrator, /native V2 `subagent` tool/)
assert.doesNotMatch(orchestrator, /subagent_type/)
assert.match(orchestrator, /Never implement the phase yourself as the orchestrator/)
assert.match(developer, /^mode:\s*subagent$/m)
assert.match(developer, /^model:\s*axet\/gpt-5\.3-codex$/m)
assert.match(config, /"sdlc-developer"\s*:\s*\{\s*"model"\s*:\s*"axet\/gpt-5\.3-codex"/)
assert.match(smoke, /native V2 `subagent` tool/)
assert.match(smoke, /agent: "sdlc-developer"/)
assert.match(smoke, /orchestrator must not create, edit, or test that file itself/i)

const agents = await readdir(new URL(".opencode/agents/", root))
for (const name of agents.filter((entry) => entry.startsWith("sdlc-") && entry.endsWith(".md"))) {
  const source = await read(`.opencode/agents/${name}`)
  assert.match(source, /^mode:\s*(primary|subagent|all)$/m, `${name} lacks a V2 mode`)
  assert.match(source, /^model:\s*axet\/[^\s]+$/m, `${name} lacks an AXET model`)
}

console.log("OpenCode V2 delegation configuration: PASS")
