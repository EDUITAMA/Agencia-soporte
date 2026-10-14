import { validateNodeResult } from "./contracts.mjs"

const OPEN = "<SDLC_NODE_RESULT>"
const CLOSE = "</SDLC_NODE_RESULT>"

export function parseNodeResult(text, expectedNode) {
  const source = String(text || "")
  const start = source.lastIndexOf(OPEN)
  const end = source.lastIndexOf(CLOSE)
  if (start < 0 || end < start) throw new Error("Child response is missing <SDLC_NODE_RESULT>")
  const body = source.slice(start + OPEN.length, end).trim()
  let raw
  try {
    raw = JSON.parse(body)
  } catch (error) {
    throw new Error(`Invalid SDLC node result JSON: ${error.message}`)
  }
  const result = validateNodeResult(raw)
  if (expectedNode && result.node !== expectedNode) throw new Error(`Child result node ${result.node} does not match expected ${expectedNode}`)
  return result
}

export { OPEN as NODE_RESULT_OPEN, CLOSE as NODE_RESULT_CLOSE }
