import { TERMINAL_NODES, validateNodeResult } from "./contracts.mjs"

function canRepair(state) {
  return (state.cycles?.repair || 0) < (state.limits?.maxRepairCycles ?? 3)
}

function completeAllowed(state) {
  // The REVIEW result being resolved has not yet been committed into gates.
  return ["plan", "implementation", "test"].every((gate) => state.gates?.[gate] === "PASS")
}

export function resolveNextNode(state, rawResult) {
  const result = validateNodeResult(rawResult)
  if (TERMINAL_NODES.includes(state.currentNode)) throw new Error("Cannot transition a terminal graph")
  if (state.currentNode !== result.node) throw new Error(`Result node ${result.node} does not match active node ${state.currentNode}`)

  const repair = (reason) => canRepair(state)
    ? { nextNode: "REPAIR", reason, increment: { repair: 1 } }
    : { nextNode: "FAILED", reason: "REPAIR_CYCLE_LIMIT_REACHED", cycleLimitReached: true }
  const blocked = (reason) => ({ nextNode: "BLOCKED", reason })
  const failed = (reason) => ({ nextNode: "FAILED", reason })

  switch (result.node) {
    case "PLAN":
      if (result.status === "PASS") return { nextNode: "IMPLEMENT", reason: "PLAN_PASSED" }
      return result.status === "BLOCKED" ? blocked("PLAN_BLOCKED") : failed("PLAN_FAILED")
    case "IMPLEMENT":
      if (result.status === "PASS") return { nextNode: "TEST", reason: "IMPLEMENT_PASSED" }
      return result.status === "BLOCKED" ? blocked("IMPLEMENT_BLOCKED") : repair("IMPLEMENT_FAILED")
    case "TEST":
      if (result.status === "PASS") return { nextNode: "REVIEW", reason: "TEST_PASSED" }
      return result.status === "BLOCKED" ? blocked("TEST_BLOCKED") : repair("TEST_FAILED")
    case "REPAIR":
      if (result.status === "PASS") return { nextNode: "TEST", reason: "REPAIR_PASSED" }
      return result.status === "BLOCKED" ? blocked("REPAIR_BLOCKED") : failed("REPAIR_FAILED")
    case "REVIEW":
      if (result.status === "PASS") return completeAllowed(state)
        ? { nextNode: "COMPLETE", reason: "REVIEW_PASSED" }
        : failed("REQUIRED_GATE_PENDING")
      if (result.status === "BLOCKED") return blocked("REVIEW_BLOCKED")
      if (result.status === "FAILED") return failed("REVIEW_FAILED")
      if ((state.cycles?.review || 0) >= (state.limits?.maxReviewCycles ?? 2)) {
        return { nextNode: "FAILED", reason: "REVIEW_CYCLE_LIMIT_REACHED", cycleLimitReached: true }
      }
      return repair("REVIEW_CHANGES_REQUESTED")
    default:
      throw new Error(`No transition exists for ${result.node}`)
  }
}
