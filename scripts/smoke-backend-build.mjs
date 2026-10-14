import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "apps", "backend", "dist", "server.js");
const port = Number(process.env.SMOKE_PORT ?? 3100);
const child = spawn(process.execPath, [serverPath], {
  cwd: root,
  env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
  stdio: "inherit",
});

async function waitForHealth() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = await response.json();
      if (response.ok && body.status === "ok") return;
    } catch {
      // The server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Backend did not become healthy within 20 seconds.");
}

try {
  await waitForHealth();
  console.log("Backend smoke passed.");
} finally {
  child.kill("SIGTERM");
}
