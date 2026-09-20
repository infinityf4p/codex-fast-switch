param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('discover', 'signature', 'processes', 'quit', 'open', 'identity', 'remove-identity', 'enable', 'disable', 'start-watch', 'shortcuts', 'remove-shortcuts', 'launch', 'start-update')]
    [string]$Action,
    [string]$Payload = 'e30='
)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json

function Get-AppProcesses {
    $paths = @($data.binaries)
    $names = @($paths | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_) } | Select-Object -Unique)
    foreach ($name in $names) {
        foreach ($item in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
            $binary = $item.Path
            if (-not $binary) { throw "Cannot determine the executable path of $name (PID $($item.Id)). Close the app and retry." }
            $item
        }
    }
}

function Test-MonitorShortcut($shortcut) {
    foreach ($script in @($data.script, $data.legacyScript)) {
        if ($script -and $shortcut.Arguments.IndexOf(('-File "' + $script + '" -Action start-watch -Payload '), [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $true
        }
    }
    return $false
}

function Quote-ProcessArgument([string]$value) {
    '"' + [Regex]::Replace([Regex]::Replace($value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Get-LocalIdentityPath($value) {
    if ($value -isnot [string] -or $value -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))') {
        throw 'A local package path must be absolute.'
    }
    return [IO.Path]::GetFullPath($value).TrimEnd('\')
}

function Get-LocalIdentityDirectory($value) {
    $resolved = Get-LocalIdentityPath $value
    $current = $resolved
    while ($current) {
        $entry = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "A local package directory is redirected: $current"
        }
        if ($current -ieq ([IO.Path]::GetPathRoot($current).TrimEnd('\'))) { break }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    return $resolved
}

function Get-LocalIdentityGeneration($value, [string]$state) {
    $root = Get-LocalIdentityPath $value
    $id = [IO.Path]::GetFileName($root)
    if ([IO.Path]::GetDirectoryName($root) -ine (Join-Path $state 'versions') -or
        $id -notmatch '^\d+-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') {
        throw 'The local package registration is outside the selected installation generations.'
    }
    return Get-LocalIdentityDirectory $root
}

function Assert-LocalIdentityRecord([string]$root) {
    $file = Join-Path $root 'record.json'
    $entry = Get-Item -LiteralPath $file -Force -ErrorAction Stop
    if ($entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The local package generation record is redirected.'
    }
    $record = Get-Content -LiteralPath $file -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($record.patchId -cne 'codex-fast-switch-windows-v1' -or
        $record.id -ine [IO.Path]::GetFileName($root) -or
        (Get-LocalIdentityPath $record.app) -ine (Join-Path $root 'app')) {
        throw 'The local package generation record does not belong to this installation.'
    }
    [void](Get-LocalIdentityDirectory (Join-Path $root 'app'))
    $manifest = Get-Item -LiteralPath (Join-Path $root 'AppxManifest.xml') -Force -ErrorAction Stop
    if ($manifest.PSIsContainer -or ($manifest.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The local package manifest is redirected.'
    }
}

function Test-LocalIdentityPackage($package, [string[]]$roots) {
    return $package.Name -ieq 'CodexFast.Switch' -and $package.Publisher -ieq 'CN=CodexFastLocal' -and
        $package.InstallLocation -and $roots -icontains (Get-LocalIdentityPath $package.InstallLocation)
}

try { switch ($Action) {
    'discover' {
        $packages = @(Get-AppxPackage -Name OpenAI.Codex | Where-Object {
            $_.Publisher -eq 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B' -and
            $_.Status -eq 'Ok' -and -not $_.IsDevelopmentMode
        } | Sort-Object { [version]$_.Version } -Descending | ForEach-Object {
            @{ app = (Join-Path $_.InstallLocation 'app'); package = $_.PackageFullName; version = $_.Version.ToString() }
        })
        ConvertTo-Json -InputObject $packages -Compress
    }
    'signature' {
        $result = @(foreach ($file in $data.files) {
            $signature = Get-AuthenticodeSignature -LiteralPath $file
            $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($file)
            @{ file = $file; status = $signature.Status.ToString(); subject = $signature.SignerCertificate.Subject;
                fileVersion = $version.FileVersion; productName = $version.ProductName }
        })
        ConvertTo-Json -InputObject $result -Compress
    }
    'processes' {
        $result = @(Get-AppProcesses | ForEach-Object { @{ pid = $_.Id; path = $_.Path } })
        ConvertTo-Json -InputObject $result -Compress
    }
    'quit' {
        $targets = @(Get-AppProcesses | Where-Object { $data.binaries -contains $_.Path })
        if (-not $targets.Count) { break }
        Add-Type -Path (Join-Path $PSScriptRoot 'quit.cs')
        $targetIds = @($targets | ForEach-Object { $_.Id })
        $roots = @(foreach ($item in $targets) {
            $info = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $item.Id)
            if ($info -and $targetIds -notcontains $info.ParentProcessId) { $info }
        })
        foreach ($root in $roots) {
            $item = $targets | Where-Object { $_.Id -eq $root.ProcessId } | Select-Object -First 1
            if ($item.HasExited) { continue }
            if (-not [CodexFastQuit]::HasVisibleWindow($item.Id)) {
                $arguments = [CodexFastQuit]::ActivationArguments($root.CommandLine)
                $start = @{ FilePath = $item.Path; WorkingDirectory = [IO.Path]::GetDirectoryName($item.Path); WindowStyle = 'Normal' }
                if ($arguments) { $start.ArgumentList = $arguments }
                Start-Process @start | Out-Null
                $deadline = [DateTime]::UtcNow.AddSeconds(15)
                while (-not $item.HasExited -and -not [CodexFastQuit]::HasVisibleWindow($item.Id) -and [DateTime]::UtcNow -lt $deadline) {
                    Start-Sleep -Milliseconds 200
                }
            }
            if ($item.HasExited) { continue }
            [CodexFastQuit]::Request($item.Id)
            # Keep focus on a pending quit dialog instead of sending keys to another window.
            if (-not $item.WaitForExit(10000)) { break }
        }
    }
    'open' {
        # The Owl runtime refuses to start without a package identity: a copy launched
        # by path dies with "The process has no package identity." Activate the
        # registered local package instead so the process keeps its identity.
        $packageName = if ($data.packageName) { $data.packageName } else { 'CodexFast.Switch' }
        $activated = $false
        foreach ($package in @(Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue |
                Where-Object { $_.Status -eq 'Ok' -and $_.InstallLocation })) {
            $root = [IO.Path]::GetFullPath($package.InstallLocation).TrimEnd('\') + '\'
            if ([IO.Path]::GetFullPath($data.binary).StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
                if (-not ('CodexFastActivation' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'activate.cs') }
                [CodexFastActivation]::Activate(($package.PackageFamilyName + '!App'), [string]$data.userData) | Out-Null
                $activated = $true
                break
            }
        }
        if (-not $activated) {
            $start = @{ FilePath = $data.binary; WorkingDirectory = [IO.Path]::GetDirectoryName($data.binary) }
            if ($data.userData) { $start.ArgumentList = Quote-ProcessArgument ('--user-data-dir=' + $data.userData) }
            Start-Process @start | Out-Null
        }
    }
    'identity' {
        if ($data.name -cne 'CodexFast.Switch') { throw 'Unexpected local package identity.' }
        $requested = Get-LocalIdentityPath $data.root
        $state = Get-LocalIdentityDirectory ([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($requested)))
        $root = Get-LocalIdentityGeneration $requested $state
        Assert-LocalIdentityRecord $root
        $previous = @(foreach ($package in @(Get-AppxPackage -Name CodexFast.Switch -ErrorAction Stop)) {
            if ($package.Name -ine 'CodexFast.Switch' -or $package.Publisher -ine 'CN=CodexFastLocal' -or -not $package.PackageFullName) {
                throw 'Refusing to replace an unrelated local package registration.'
            }
            $oldRoot = Get-LocalIdentityGeneration $package.InstallLocation $state
            Assert-LocalIdentityRecord $oldRoot
            @{ package = $package; root = $oldRoot }
        })
        $current = @($previous | Where-Object { $_.package.Status -eq 'Ok' -and
            $_.package.Version.ToString() -eq $data.version -and $_.root -ieq $root })
        if (-not $current.Count) {
            $oldBinaries = @($previous | ForEach-Object { Join-Path $_.root 'app\ChatGPT.exe' })
            if ($oldBinaries.Count) {
                foreach ($process in @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -eq 'ChatGPT' })) {
                    if (-not $process.Path) { throw 'Cannot determine whether a local package app is still running.' }
                    if ($oldBinaries -icontains (Get-LocalIdentityPath $process.Path)) {
                        throw 'The previous local package app is still running. Quit it before changing its registration.'
                    }
                }
            }
            $removed = @()
            try {
                foreach ($old in $previous) {
                    [void](Get-LocalIdentityGeneration $old.root $state)
                    Remove-AppxPackage -Package $old.package.PackageFullName -ErrorAction Stop
                    $removed += $old
                }
                Add-AppxPackage -Register (Join-Path $root 'AppxManifest.xml') -ErrorAction Stop
                $registered = @(Get-AppxPackage -Name CodexFast.Switch -ErrorAction Stop | Where-Object {
                    $_.Status -eq 'Ok' -and (Test-LocalIdentityPackage $_ @($root))
                })
                if ($registered.Count -ne 1) { throw 'The local package identity could not be registered at the selected generation.' }
            } catch {
                $failure = $_.Exception.Message
                $recoveryErrors = @()
                if ($removed.Count) {
                    try {
                        foreach ($partial in @(Get-AppxPackage -Name CodexFast.Switch -ErrorAction Stop | Where-Object {
                            Test-LocalIdentityPackage $_ @($root)
                        })) {
                            Remove-AppxPackage -Package $partial.PackageFullName -ErrorAction Stop
                        }
                    } catch { $recoveryErrors += $_.Exception.Message }
                    foreach ($old in $removed) {
                        try {
                            [void](Get-LocalIdentityGeneration $old.root $state)
                            Assert-LocalIdentityRecord $old.root
                            Add-AppxPackage -Register (Join-Path $old.root 'AppxManifest.xml') -ErrorAction Stop
                            $restored = @(Get-AppxPackage -Name CodexFast.Switch -ErrorAction Stop | Where-Object {
                                $_.Status -eq 'Ok' -and (Test-LocalIdentityPackage $_ @($old.root))
                            })
                            if (-not $restored.Count) { throw 'The previous package registration was not restored.' }
                        } catch { $recoveryErrors += $_.Exception.Message }
                    }
                }
                if ($recoveryErrors.Count) { $failure += ' Registration recovery failed: ' + ($recoveryErrors -join '; ') }
                throw $failure
            }
        } else {
            if ($data.refresh) { Add-AppxPackage -Register (Join-Path $root 'AppxManifest.xml') -ErrorAction Stop }
            $registered = @(Get-AppxPackage -Name CodexFast.Switch -ErrorAction Stop | Where-Object {
                $_.Status -eq 'Ok' -and (Test-LocalIdentityPackage $_ @($root))
            })
            if ($registered.Count -ne 1) { throw 'The local package identity could not be registered at the selected generation.' }
        }
        @{ packageFullName = $registered.PackageFullName; packageFamilyName = $registered.PackageFamilyName;
            installLocation = $registered.InstallLocation } | ConvertTo-Json -Compress
    }
    'remove-identity' {
        $state = Get-LocalIdentityDirectory $data.state
        if ($state -ieq ([IO.Path]::GetPathRoot($state).TrimEnd('\')) -or $data.roots -isnot [Array]) {
            throw 'Invalid local package removal scope.'
        }
        $roots = @()
        foreach ($candidate in $data.roots) {
            $root = Get-LocalIdentityGeneration $candidate $state
            if ($roots -inotcontains $root) { $roots += $root }
        }
        $removed = @()
        foreach ($package in @(Get-AppxPackage -Name CodexFast.Switch -ErrorAction Stop | Where-Object {
            Test-LocalIdentityPackage $_ $roots
        })) {
            if (-not $package.PackageFullName) { throw 'The local package registration has no full name.' }
            [void](Get-LocalIdentityGeneration $package.InstallLocation $state)
            Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop
            $removed += $package.PackageFullName
        }
        if ($removed.Count) {
            $remaining = @(Get-AppxPackage -Name CodexFast.Switch -ErrorAction Stop | Where-Object {
                Test-LocalIdentityPackage $_ $roots
            })
            if ($remaining.Count) { throw 'The local package identity is still registered after removal.' }
        }
        @{ status = $(if ($removed.Count) { 'removed' } else { 'not-registered' }); removed = @($removed) } | ConvertTo-Json -Compress
    }
    'shortcuts' { . (Join-Path $PSScriptRoot 'shortcuts.ps1'); Update-AppShortcuts $data $false }
    'remove-shortcuts' { . (Join-Path $PSScriptRoot 'shortcuts.ps1'); Update-AppShortcuts $data $true }
    'launch' {
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $output = & $data.node $data.worker launch --state $data.state 2>&1
            $exitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        if ($exitCode -ne 0) { throw (($output | Out-String).Trim()) }
    }
    'start-watch' {
        $arguments = '"' + $data.worker + '" watch --state "' + $data.state + '"'
        Start-Process -FilePath $data.node -ArgumentList $arguments -WindowStyle Hidden -WorkingDirectory $data.state | Out-Null
    }
    'start-update' {
        $arguments = (@($data.worker, 'install', $data.state, $data.id, $data.token) | ForEach-Object { Quote-ProcessArgument $_ }) -join ' '
        # Explorer owns this process so Owl shutdown cannot terminate the update worker.
        $shell = New-Object -ComObject Shell.Application
        $shell.ShellExecute($data.node, $arguments, $data.state, 'open', 0)
    }
    'enable' {
        $startup = [Environment]::GetFolderPath('Startup')
        if (-not $startup) { throw 'The current user Startup folder is unavailable.' }
        $shortcutPath = Join-Path $startup ($data.name + '.lnk')
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        if ((Test-Path -LiteralPath $shortcutPath) -and -not (Test-MonitorShortcut $shortcut)) {
            throw 'An unrelated Startup shortcut already uses this name.'
        }
        $shortcut.TargetPath = $powershell
        $shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $data.script + '" -Action start-watch -Payload ' + $data.watchPayload
        $shortcut.WorkingDirectory = $data.state
        $shortcut.WindowStyle = 7
        $shortcut.Description = 'Update the local Codex Fast Switch copy when Codex is closed.'
        $shortcut.Save()
        @{ shortcut = $shortcutPath } | ConvertTo-Json -Compress
    }
    'disable' {
        $shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) ($data.name + '.lnk')
        if (Test-Path -LiteralPath $shortcutPath) {
            $shell = New-Object -ComObject WScript.Shell
            if (-not (Test-MonitorShortcut ($shell.CreateShortcut($shortcutPath)))) {
                throw 'Refusing to remove an unrelated Startup shortcut.'
            }
            Remove-Item -LiteralPath $shortcutPath
        }
    }
} } catch {
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    if ($Action -eq 'launch') {
        Add-Type -AssemblyName System.Windows.Forms
        [void][Windows.Forms.MessageBox]::Show($cause.Message, 'Codex Fast')
    }
    @{ error = @{ code = 'WINDOWS_NATIVE_FAILED'; message = $cause.Message; action = $Action } } | ConvertTo-Json -Depth 3 -Compress
    exit 1
}
