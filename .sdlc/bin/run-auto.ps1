param(
  [Parameter(Mandatory = $true)]
  [string]$Request
)

$ErrorActionPreference = "Stop"
& opencode run --auto --agent sdlc-orchestrator --command sdlc-start $Request
exit $LASTEXITCODE
