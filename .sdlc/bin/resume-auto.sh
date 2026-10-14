#!/usr/bin/env sh
set -eu

RUN_ID="${1:-current}"
exec opencode run --auto --agent sdlc-orchestrator --command sdlc-resume "$RUN_ID"
