import { promises as fs } from "node:fs"
import path from "node:path"

export const graphStatePath = (runDirectory) => path.join(runDirectory, "graph-state.json")
export const graphEventsPath = (runDirectory) => path.join(runDirectory, "graph-events.jsonl")

export async function loadGraphState(runDirectory) {
  return JSON.parse(await fs.readFile(graphStatePath(runDirectory), "utf8"))
}

export async function saveGraphState(runDirectory, state, events = []) {
  await fs.mkdir(runDirectory, { recursive: true })
  const target = graphStatePath(runDirectory)
  const temporary = `${target}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  await fs.rename(temporary, target)
  if (events.length) await fs.appendFile(graphEventsPath(runDirectory), `${events.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8")
}
