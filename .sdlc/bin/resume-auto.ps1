param(
  [string]$RunId = "current"
)

$ErrorActionPreference = "Stop"
& opencode run --auto --agent sdlc-orchestrator --command sdlc-resume $RunId
exit $LASTEXITCODE
