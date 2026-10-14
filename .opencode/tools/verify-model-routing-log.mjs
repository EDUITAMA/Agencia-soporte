import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const bridgeLog = process.argv[2]
if (!bridgeLog) throw new Error("Usage: node .opencode/tools/verify-model-routing-log.mjs <bridge.log>")

const text = await readFile(bridgeLog, "utf8")
const models = [...text.matchAll(/(?:model\s*[=:]\s*|"model"\s*:\s*")([\w.-]+\/[\w.-]+)/g)].map((match) => match[1])
const routingIndex = models.lastIndexOf("openai/gpt-5.6-luna")
assert.notEqual(routingIndex, -1, "bridge log does not contain the routing model")
const executionModels = models.slice(routingIndex + 1)
assert.ok(executionModels.includes("openai/gpt-5.3-codex"), "bridge log does not contain a COMPLEX_CODING execution request after routing")
assert.notEqual(executionModels[executionModels.indexOf("openai/gpt-5.3-codex")], "openai/gpt-5.6-luna", "execution inherited Luna")
console.log(JSON.stringify({ verdict: "PASS", routingModel: "openai/gpt-5.6-luna", executionModel: "openai/gpt-5.3-codex", observedModels: models }, null, 2))
