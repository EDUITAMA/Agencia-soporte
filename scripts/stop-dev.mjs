import { spawnSync } from "node:child_process";

const patterns = process.argv.slice(2);
if (patterns.length === 0) {
  console.error("Usage: node scripts/stop-dev.mjs <pattern> [...patterns]");
  process.exit(1);
}

if (process.platform !== "win32") {
  for (const pattern of patterns) {
    spawnSync("pkill", ["-f", pattern], { stdio: "ignore" });
  }
  process.exit(0);
}

const escaped = patterns.map((pattern) => pattern.replace(/'/g, "''").replace(/[\^$.*+?()[\]{}|]/g, "\\$&"));
const expression = escaped.map((pattern) => `$_.CommandLine -match '${pattern}'`).join(" -or ");
const command = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and (${expression}) -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { taskkill /PID $_.ProcessId /T /F *> $null }`;
spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { stdio: "inherit" });
