$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
$fastSetupExit = 1
$fastCommand = '__CODEX_FAST_COMMAND__'
$fastScratch = $null
$fastTempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$fastPayload = @'
__CODEX_FAST_PAYLOAD__
'@
try {
    $fastAction = if ($fastCommand -eq 'uninstall') { 'Uninstall' } else { 'Install or Update' }
    Write-Host ('Codex Fast Switch - ' + $fastAction) -ForegroundColor Cyan
    Write-Host 'Checking the embedded Windows package...'
    $fastBytes = [Convert]::FromBase64String($fastPayload)
    $fastHasher = [Security.Cryptography.SHA256]::Create()
    try { $fastHash = [BitConverter]::ToString($fastHasher.ComputeHash($fastBytes)).Replace('-', '').ToLowerInvariant() }
    finally { $fastHasher.Dispose() }
    if ($fastHash -ne '__CODEX_FAST_SHA256__') { throw 'The embedded package is damaged. Download the one-click script again.' }

    $fastScratch = Join-Path $fastTempPrefix ('CodexFastSwitch-setup-' + [Guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $fastScratch)
    $fastArchiveFile = Join-Path $fastScratch 'package.zip'
    [IO.File]::WriteAllBytes($fastArchiveFile, $fastBytes)
    $fastExtracted = Join-Path $fastScratch 'files'
    $fastPackagePrefix = [IO.Path]::GetFullPath((Join-Path $fastExtracted '__CODEX_FAST_PACKAGE__')) + '\'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fastArchive = [IO.Compression.ZipFile]::OpenRead($fastArchiveFile)
    try {
        foreach ($entry in $fastArchive.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $fastExtracted $entry.FullName))
            if (-not ($target + '\').StartsWith($fastPackagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'The embedded package contains an unexpected path.'
            }
        }
    } finally { $fastArchive.Dispose() }
    Write-Host 'Unpacking bundled tools and dependencies...'
    [IO.Compression.ZipFile]::ExtractToDirectory($fastArchiveFile, $fastExtracted)
    $fastRunner = Join-Path $fastExtracted '__CODEX_FAST_PACKAGE__\bin\run.ps1'
    if (-not (Test-Path -LiteralPath $fastRunner -PathType Leaf)) { throw 'The embedded package is missing its launcher.' }
    if ($env:CODEX_FAST_SETUP_HELP -eq '1') {
        & $fastRunner $fastCommand '--help'
    } else {
        if ($fastCommand -eq 'uninstall') {
            Write-Host 'Quitting local copies normally, removing Fast Switch files and automatic patches, and returning to the original app.'
        } else {
            Write-Host 'Installing or updating the Fast copy and automatic patches. Codex will restart if needed.'
        }
        & $fastRunner $fastCommand
    }
    $fastSetupExit = $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    [void](Read-Host 'Press Enter to close')
} finally {
    if ($fastScratch -and (Test-Path -LiteralPath $fastScratch -PathType Container)) {
        $fastResolved = (Resolve-Path -LiteralPath $fastScratch).ProviderPath
        if ($fastResolved -eq $fastScratch -and $fastResolved.StartsWith($fastTempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $fastResolved -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
exit $fastSetupExit
