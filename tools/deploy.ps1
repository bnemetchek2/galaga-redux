param(
    [string]$Environment = ''
)

# Build the site, then publish it to the Cloudflare Worker "galaga-redux".
#
#   .\tools\deploy.ps1              # production
#   .\tools\deploy.ps1 -Environment staging
#
# Requires a Wrangler login (`npx wrangler login`) or a CLOUDFLARE_API_TOKEN
# with Workers Scripts:Edit and Account:Read.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '[deploy] building...'
& (Join-Path $PSScriptRoot 'build.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$wrangler = Join-Path $root 'node_modules/wrangler/wrangler-dist/cli.js'
$args = @($wrangler, 'deploy')
if ($Environment) { $args += @('--env', $Environment) }

Write-Host '[deploy] uploading to Cloudflare...'
node @args
exit $LASTEXITCODE
