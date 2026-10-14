---
name: repository-discovery
description: Discover an unfamiliar repository's stack, commands, architecture, conventions and relevant files without modifying it or reading secrets.
license: MIT
compatibility: opencode
metadata:
  category: discovery
  scope: universal
---

# Repository Discovery

## Discovery order

1. Read root instructions: `AGENTS.md`, README, contribution guide and build documentation.
2. Inspect version-control status and file list.
3. Detect manifests, lockfiles, workspace definitions and solution/project files.
4. Identify source, test, infrastructure, generated and documentation roots.
5. Infer build, lint, typecheck, test, coverage and local-run commands from scripts and CI.
6. Trace only the subsystem relevant to the request.
7. Record uncertainty rather than guessing.

## Stack signals

Recognize common ecosystems without assuming them:

- JavaScript/TypeScript: package manifests, workspace files, tsconfig, framework config.
- .NET: solution and project files, `Directory.Build.*`, test projects.
- Java/Kotlin: Maven/Gradle files and module layout.
- Python: `pyproject.toml`, lockfiles, tox/nox, package layout.
- Go: modules, workspaces and package tests.
- Rust: Cargo workspace and feature configuration.
- Mobile, data, IaC and polyglot repositories: identify their native tooling and boundaries.

## Command confidence

For every inferred command, record source and confidence:

- documented in repository;
- declared in manifest/script;
- observed in CI;
- inferred convention only.

Do not execute bootstrap or dependency installation during discovery unless required and safe. Never inspect real environment files.

## Architecture map

Record entry points, bounded modules, dependency direction, data stores, external integrations, asynchronous flows, deployment units and existing test seams. Include only components relevant to the request plus enough surrounding context to prevent an invalid change.
