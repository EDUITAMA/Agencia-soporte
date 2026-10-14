export const NODES = Object.freeze(["START", "PLAN", "IMPLEMENT", "TEST", "REPAIR", "REVIEW", "COMPLETE", "BLOCKED", "FAILED"])

export const FAILURE_CLASSES = Object.freeze([
  "BUSINESS_FAILURE",
  "TOOL_FAILURE",
  "MODEL_FAILURE",
  "VALIDATION_FAILURE",
  "PERMISSION_FAILURE",
  "TIMEOUT",
  "INTERRUPTED",
])

export const RESULT_STATUSES = Object.freeze({
  PLAN: ["PASS", "BLOCKED", "FAILED"],
  IMPLEMENT: ["PASS", "FAILED", "BLOCKED"],
  TEST: ["PASS", "FAILED", "BLOCKED"],
  REPAIR: ["PASS", "FAILED", "BLOCKED"],
  REVIEW: ["PASS", "CHANGES_REQUESTED", "BLOCKED", "FAILED"],
})

export const EXECUTABLE_NODES = Object.freeze(Object.keys(RESULT_STATUSES))
export const TERMINAL_NODES = Object.freeze(["COMPLETE", "BLOCKED", "FAILED"])

export function isNode(value) {
  return NODES.includes(value)
}

export function validateNodeResult(result) {
  if (!result || typeof result !== "object") throw new Error("Graph node result must be an object")
  if (!EXECUTABLE_NODES.includes(result.node)) throw new Error(`Unsupported graph result node: ${result.node}`)
  if (!RESULT_STATUSES[result.node].includes(result.status)) {
    throw new Error(`Invalid ${result.node} result status: ${result.status}`)
  }
  if (result.failureClass && !FAILURE_CLASSES.includes(result.failureClass)) {
    throw new Error(`Invalid graph failure class: ${result.failureClass}`)
  }
  for (const key of ["evidence", "findings"]) {
    if (result[key] !== undefined && !Array.isArray(result[key])) throw new Error(`Graph result ${key} must be an array`)
  }
  if (result.summary !== undefined && typeof result.summary !== "string") throw new Error("Graph result summary must be a string")
  if (result.operations !== undefined && !Array.isArray(result.operations)) throw new Error("Graph result operations must be an array")
  return {
    node: result.node,
    status: result.status,
    summary: result.summary || "",
    evidence: result.evidence || [],
    findings: result.findings || [],
    failureClass: result.failureClass || null,
    operations: result.operations || [],
  }
}
