import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "apps/backend/package.json",
  "apps/backend/.env.example",
  "apps/backend/src/app.ts",
  "apps/backend/src/server.ts",
  "apps/backend/test/api.test.ts",
  "apps/frontend/angular-app/package.json",
  "apps/frontend/angular-app/angular.json",
  "apps/frontend/angular-app/src/app/app.component.ts",
  "deploy/templates/deploy-config.example.json",
  "deploy/templates/environment.example.env",
  "deploy/templates/README.md",
  "docs/architecture/repository-layout.md",
  "docs/deployment/configuration.md",
  "docs/development/local-setup.md",
  "local-fixtures/README.md",
  ".gitlab-ci.yml",
];
const prohibitedTerms = [/terpel/i, /\brca\b/i, /duckdb/i, /agent/i];
const excludedDirectories = new Set(["node_modules", "dist", "coverage", ".git"]);

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`Required file missing: ${file}`);
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(target);
      continue;
    }
    if (!/\.(?:md|json|mjs|ts|css|html|yml|env)$/i.test(entry.name) && entry.name !== ".gitignore" && entry.name !== ".nvmrc") continue;
    const relative = path.relative(root, target).replaceAll("\\", "/");
    if (relative === "scripts/validate-project.mjs" || relative.endsWith("package-lock.json")) continue;
    const content = fs.readFileSync(target, "utf8");
    for (const term of prohibitedTerms) {
      if (term.test(content)) {
        throw new Error(`Prohibited reference in ${relative}: ${term}`);
      }
    }
  }
}

walk(root);
console.log("Project validation passed.");
