param(
  [switch]$RefreshRepoDependencies
)

$ErrorActionPreference = "Stop"
$Repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Repo

Write-Host "Setting up Web QA Assistant for Cursor..." -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required and was not found on PATH." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required and was not found on PATH." }

if (-not (Test-Path ".cursor\webqa.env")) {
  Copy-Item ".cursor\webqa.env.example" ".cursor\webqa.env"
  Write-Host "Created .cursor\webqa.env from the safe template." -ForegroundColor Green
} else {
  Write-Host ".cursor\webqa.env already exists; leaving it unchanged." -ForegroundColor DarkGray
}

if (-not (Test-Path ".gitignore")) {
  New-Item -ItemType File -Path ".gitignore" | Out-Null
}

$existingLines = @(Get-Content ".gitignore" -ErrorAction SilentlyContinue)
$needed = @(".cursor/webqa.env", "qa-runs/", "tools/cursor-webqa/node_modules/")
$missing = @($needed | Where-Object { $_ -notin $existingLines })
if ($missing.Count -gt 0) {
  Add-Content ".gitignore" ""
  Add-Content ".gitignore" "# Local Cursor/WebQA development state"
  foreach ($line in $missing) { Add-Content ".gitignore" $line }
  Write-Host "Added local Cursor/WebQA state to .gitignore." -ForegroundColor Green
}

if ($RefreshRepoDependencies -or -not (Test-Path "node_modules")) {
  Write-Host "Installing repository dependencies from the existing lockfile..." -ForegroundColor Cyan
  npm ci
} else {
  Write-Host "Repository node_modules already exists; leaving it intact. Use -RefreshRepoDependencies to force npm ci." -ForegroundColor DarkGray
}

$ToolLock = "tools/cursor-webqa/package-lock.json"
if (Test-Path $ToolLock) {
  Write-Host "Installing isolated WebQA MCP dependency from its lockfile..." -ForegroundColor Cyan
  npm ci --prefix tools/cursor-webqa
} else {
  Write-Host "Installing isolated WebQA MCP dependency and creating its first lockfile..." -ForegroundColor Cyan
  npm install --prefix tools/cursor-webqa
  Write-Host "Review and commit tools/cursor-webqa/package-lock.json for reproducible future installs." -ForegroundColor Yellow
}

Write-Host "Running Cursor/WebQA setup doctor..." -ForegroundColor Cyan
node tools/cursor-webqa/doctor.mjs

Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Open this repository folder in Cursor (do not create a second clone)."
Write-Host "2. Import your VS Code profile/settings and keep Window Layout set to Editor."
Write-Host "3. In Cursor, open Customize -> MCPs and approve the project 'webqa' server."
Write-Host "4. In Agent, ask: Use webqa_health and tell me whether the development environment is ready."
Write-Host "5. Use Cursor's native Browser for ordinary public-page acceptance."
Write-Host "6. Optional later: enable the Playwright existing-Chrome bridge only when profile/session parity is specifically needed."
Write-Host "7. Run /webqa-acceptance for a first cross-discipline smoke test."
