param(
    [string]$Command = 'status',
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Options
)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
$fastRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fastResult = 1
$fastRuntimeScratch = $null
$fastTempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
try {
    $candidates = @()
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) { $candidates += $systemNode.Source }
    $candidates += Join-Path $env:LOCALAPPDATA 'Codex Fast Switch\agent\node.exe'
    foreach ($package in @(Get-AppxPackage -Name OpenAI.Codex | Sort-Object { [version]$_.Version } -Descending)) {
        $candidates += Join-Path $package.InstallLocation 'app\resources\cua_node\bin\node.exe'
    }
    $fastNode = $null
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        & $candidate -e 'const [a,b]=process.versions.node.split(/\./).map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' 2>$null
        if ($LASTEXITCODE -eq 0) { $fastNode = $candidate; break }
    }
    if (-not $fastNode) { throw 'Node.js 22.12 or newer was not found. Install Node.js or use the runtime bundled with Codex.' }
    if (-not (Test-Path -LiteralPath (Join-Path $fastRoot 'node_modules\@electron\asar'))) {
        throw 'Dependencies are missing. Use the Windows release ZIP, or run npm ci --ignore-scripts in the source directory.'
    }
    if ($Command -eq 'uninstall') {
        $fastRuntimeScratch = Join-Path $fastTempPrefix ('CodexFastSwitch-uninstall-' + [Guid]::NewGuid().ToString('N'))
        [void](New-Item -ItemType Directory -Path $fastRuntimeScratch)
        $fastRuntimeCopy = Join-Path $fastRuntimeScratch 'node.exe'
        $fastInput = [IO.File]::OpenRead($fastNode)
        try {
            $fastOutput = [IO.File]::Create($fastRuntimeCopy)
            try { $fastInput.CopyTo($fastOutput) } finally { $fastOutput.Dispose() }
        } finally { $fastInput.Dispose() }
        $fastNode = $fastRuntimeCopy
    }
    & $fastNode (Join-Path $fastRoot 'cli.cjs') $Command @Options
    $fastResult = $LASTEXITCODE
} catch { Write-Host $_.Exception.Message -ForegroundColor Red }
finally {
    if ($fastRuntimeScratch -and (Test-Path -LiteralPath $fastRuntimeScratch -PathType Container)) {
        $fastResolvedRuntime = (Resolve-Path -LiteralPath $fastRuntimeScratch).ProviderPath
        if ($fastResolvedRuntime -eq $fastRuntimeScratch -and $fastResolvedRuntime.StartsWith($fastTempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $fastResolvedRuntime -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
Write-Host ''
[void](Read-Host 'Press Enter to close')
exit $fastResult
