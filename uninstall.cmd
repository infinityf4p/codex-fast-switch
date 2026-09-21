@echo off
setlocal DisableDelayedExpansion
set "CODEX_FAST_SETUP_SELF=%~f0"
set "CODEX_FAST_SETUP_HELP=0"
if not "%~2"=="" goto usage
if "%~1"=="" goto run
if /i "%~1"=="--help" goto help
if /i "%~1"=="/?" goto help
:usage
echo Usage: "%~nx0" [--help]
exit /b 2
:help
set "CODEX_FAST_SETUP_HELP=1"
:run
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $raw=[IO.File]::ReadAllText($env:CODEX_FAST_SETUP_SELF); $marker=[regex]::Match($raw,'(?m)^# CODEX_FAST_SETUP_SCRIPT\r?$'); if (-not $marker.Success) { throw 'Installer script is incomplete.' }; & ([scriptblock]::Create($raw.Substring($marker.Index+$marker.Length))) } catch { Write-Host $_.Exception.Message; [void](Read-Host 'Press Enter to close'); exit 1 }"
exit /b %errorlevel%
# CODEX_FAST_SETUP_SCRIPT
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
$fastCommand = 'uninstall'
$fastBase = 'https://infinityf4p.github.io/codex-fast-switch/'
$fastScratch = $null
$fastSetupExit = 1
$fastTempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if ($env:CODEX_FAST_SETUP_HELP -eq '1') {
    Write-Host ('Codex Fast Switch: ' + $fastCommand)
    Write-Host 'Every run checks the latest successful main build, verifies its download and runs it.'
    Write-Host 'No GitHub Release, Git or npm installation is required. Node.js 22.12+ must be available from Codex or the system.'
    exit 0
}
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $fastScratch = Join-Path $fastTempPrefix ('CodexFastSwitch-download-' + [Guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $fastScratch)
    $fastArchiveFile = Join-Path $fastScratch 'package.zip'
    # A deployment may replace the site between metadata and ZIP requests.
    # Retry with fresh metadata; never execute a stale or mismatched download.
    for ($fastAttempt = 0; $fastAttempt -lt 2; $fastAttempt++) {
        try {
            Write-Host 'Checking the latest tested Codex Fast Switch build...' -ForegroundColor Cyan
            $fastMetadataUrl = $fastBase + 'latest.json?check=' + [Guid]::NewGuid().ToString('N')
            $fastResponse = Invoke-WebRequest -Uri $fastMetadataUrl -UseBasicParsing -TimeoutSec 30 -Headers @{'Cache-Control'='no-cache'}
            $fastLatest = $fastResponse.Content | ConvertFrom-Json
            if ($fastLatest.schemaVersion -ne 1 -or $fastLatest.commit -cnotmatch '^[a-f0-9]{40}$' -or
                $fastLatest.version -cnotmatch '^\d+\.\d+\.\d+$') { throw 'Invalid update metadata.' }
            $fastPackageName = 'codex-fast-switch-' + $fastLatest.version + '-windows'
            $fastAsset = $fastLatest.assets.win32
            $fastExpectedUrl = $fastBase + $fastLatest.commit + '/' + $fastPackageName + '.zip'
            if ($fastAsset.url -cne $fastExpectedUrl -or $fastAsset.directory -cne $fastPackageName -or
                $fastAsset.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $fastAsset.size -le 0 -or $fastAsset.size -gt 134217728) {
                throw 'The update has an unexpected download URL or checksum.'
            }
            Write-Host ('Latest build: ' + $fastLatest.commit.Substring(0, 12))
            $fastInstalledInfo = Join-Path $env:LOCALAPPDATA 'Codex Fast Switch\agent\build-info.json'
            if (Test-Path -LiteralPath $fastInstalledInfo -PathType Leaf) {
                try {
                    $fastInstalled = Get-Content -LiteralPath $fastInstalledInfo -Raw | ConvertFrom-Json
                    if ($fastInstalled.commit -eq $fastLatest.commit) { Write-Host 'This build is already installed. Checking and repairing the installation...' }
                    elseif ($fastInstalled.commit -cmatch '^[a-f0-9]{40}$') { Write-Host ('Updating from: ' + $fastInstalled.commit.Substring(0, 12)) }
                } catch { Write-Host 'Checking the existing installation...' }
            }
            Invoke-WebRequest -Uri $fastAsset.url -OutFile $fastArchiveFile -UseBasicParsing -TimeoutSec 180
            if ((Get-Item -LiteralPath $fastArchiveFile).Length -ne $fastAsset.size -or
                (Get-FileHash -LiteralPath $fastArchiveFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $fastAsset.sha256) {
                throw 'The downloaded package failed its SHA-256 check.'
            }
            break
        } catch {
            if ($fastAttempt -eq 1) { throw }
            Write-Host 'Retrying with fresh update metadata...'
        }
    }
    $fastExtracted = Join-Path $fastScratch 'files'
    $fastPackageRoot = Join-Path $fastExtracted $fastPackageName
    $fastPackagePrefix = [IO.Path]::GetFullPath($fastPackageRoot) + '\'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fastArchive = [IO.Compression.ZipFile]::OpenRead($fastArchiveFile)
    try {
        foreach ($entry in $fastArchive.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $fastExtracted $entry.FullName))
            if (-not ($target + '\').StartsWith($fastPackagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'The downloaded package contains an unexpected path.'
            }
        }
    } finally { $fastArchive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($fastArchiveFile, $fastExtracted)
    $fastBuild = Get-Content -LiteralPath (Join-Path $fastPackageRoot 'build-info.json') -Raw | ConvertFrom-Json
    if ($fastBuild.commit -cne $fastLatest.commit) { throw 'The downloaded package belongs to a different build.' }
    $fastRunner = Join-Path $fastPackageRoot 'launchers\windows\run.ps1'
    if (-not (Test-Path -LiteralPath $fastRunner -PathType Leaf)) { throw 'The downloaded package is missing its launcher.' }
    & $fastRunner $fastCommand
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
