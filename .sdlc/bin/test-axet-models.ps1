$ErrorActionPreference = "Continue"

$models = @(
  "axet/gpt-5.6-terra",
  "axet/gpt-5.6-luna",
  "axet/gpt-5.3-codex",
  "axet/gpt-5.4-2026-03-05",
  "axet/gpt-5.4-mini",
  "axet/eu.anthropic.claude-sonnet-5",
  "axet/eu.anthropic.claude-sonnet-4-6"
)

$failed = @()
foreach ($model in $models) {
  Write-Host "Testing $model ..." -ForegroundColor Cyan
  $output = & opencode run --model $model 'Responde exactamente: OK' 2>&1
  $exit = $LASTEXITCODE
  $text = ($output | Out-String).Trim()
  if ($exit -eq 0 -and $text -match '(^|\s)OK(\s|$)') {
    Write-Host "PASS $model" -ForegroundColor Green
  } else {
    Write-Host "FAIL $model" -ForegroundColor Red
    Write-Host $text
    $failed += $model
  }
}

if ($failed.Count -gt 0) {
  Write-Host "`nAXET model smoke test FAILED:" -ForegroundColor Red
  $failed | ForEach-Object { Write-Host " - $_" }
  exit 1
}

Write-Host "`nAll AXET models PASSED." -ForegroundColor Green
exit 0
