param(
    [switch]$Clean,
    [switch]$Tests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$tsc = Join-Path $root 'node_modules/typescript/bin/tsc'
Write-Host '[build] typechecking and compiling TypeScript...'
node $tsc -p tsconfig.json
if ($LASTEXITCODE -ne 0) { Write-Host '[build] tsc failed'; exit $LASTEXITCODE }

if ($Clean) {
    node tools/build.mjs --clean
} else {
    node tools/build.mjs
}
exit $LASTEXITCODE
