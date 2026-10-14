import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { applyWorkspaceActions, validateWorkspaceActions } from "./workspace-actions.mjs"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sdlc-host-actions-"))
try {
  const evidence = await applyWorkspaceActions([{ type: "writeFile", path: "smoke/marker.txt", content: "OK" }], { workspace: directory, node: "IMPLEMENT" })
  assert.equal(await fs.readFile(path.join(directory, "smoke", "marker.txt"), "utf8"), "OK")
  assert.deepEqual(evidence.evidence, [{ type: "HOST_WRITE_FILE", path: "smoke/marker.txt", bytes: 2 }])
  assert.deepEqual(evidence.failures, [])
  assert.throws(() => validateWorkspaceActions([{ type: "writeFile", path: "../escape.txt", content: "x" }], { node: "IMPLEMENT" }), /escapes workspace/)
  assert.throws(() => validateWorkspaceActions([{ type: "writeFile", path: ".env", content: "x" }], { node: "IMPLEMENT" }), /environment files/)
  assert.throws(() => validateWorkspaceActions([{ type: "writeFile", path: "x", content: "x" }], { node: "PLAN" }), /may not request workspace mutations/)
  assert.throws(() => validateWorkspaceActions([{ type: "writeFile", path: "x", content: "x" }], { node: "TEST" }), /may not request workspace mutations/)
  assert.equal(validateWorkspaceActions([{ type: "runTest", command: "node", args: ["--test"] }], { node: "TEST" })[0].type, "runTest")
  const ps = validateWorkspaceActions([{ type: "runTest", command: "powershell.exe", args: ["-NoProfile", "-File", "v.ps1"] }], { node: "TEST" })[0]
  assert.deepEqual(ps.args, ["-File", "v.ps1"])
  assert.throws(() => validateWorkspaceActions([{ type: "runTest", command: "powershell.exe", args: ["-ExecutionPolicy", "Bypass", "-File", "v.ps1"] }], { node: "TEST" }), /exactly -File/)
  const abs = path.join(directory, "smoke", "abs.txt")
  assert.equal(validateWorkspaceActions([{ type: "writeFile", path: abs, content: "x" }], { node: "IMPLEMENT", workspace: directory })[0].path, "smoke/abs.txt")
  assert.throws(() => validateWorkspaceActions([{ type: "writeFile", path: path.join(directory, "..", "out.txt"), content: "x" }], { node: "IMPLEMENT", workspace: directory }), /escapes workspace/)
  await fs.mkdir(path.join(directory, "d"), { recursive: true })
  await fs.writeFile(path.join(directory, "d", "gone.txt"), "x")
  const deleted = await applyWorkspaceActions([{ type: "deleteFile", path: "d/gone.txt" }], { workspace: directory, node: "REPAIR" })
  assert.equal(deleted.evidence[0].type, "HOST_DELETE_FILE")
  await assert.rejects(fs.access(path.join(directory, "d", "gone.txt")))
  assert.throws(() => validateWorkspaceActions([{ type: "deleteFile", path: "../x" }], { node: "REPAIR", workspace: directory }), /escapes workspace/)
  assert.throws(() => validateWorkspaceActions([{ type: "deleteFile", path: "x" }], { node: "TEST" }), /may not request/)
} finally { await fs.rm(directory, { recursive: true, force: true }) }

console.log("host workspace actions: PASS")
