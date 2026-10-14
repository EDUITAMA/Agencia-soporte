#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "Usage: .sdlc/bin/run-auto.sh \"request\"" >&2
  exit 2
fi

REQUEST="$*"
exec opencode run --auto --agent sdlc-orchestrator --command sdlc-start "$REQUEST"
