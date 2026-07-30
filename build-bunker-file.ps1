$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $workspace
try {
    npx --yes esbuild@0.25.8 data/bunker/bunker.js `
        --bundle `
        --format=iife `
        --platform=browser `
        --target=es2022 `
        --outfile=data/bunker/bunker.file.js
} finally {
    Pop-Location
}
