param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('discover', 'signature', 'processes', 'quit', 'open', 'enable', 'disable', 'start-watch')]
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
            @{ file = $file; status = $signature.Status.ToString(); subject = $signature.SignerCertificate.Subject }
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
    'open' { Start-Process -FilePath $data.binary -WorkingDirectory ([IO.Path]::GetDirectoryName($data.binary)) | Out-Null }
    'start-watch' {
        $arguments = '"' + $data.worker + '" watch --state "' + $data.state + '"'
        Start-Process -FilePath $data.node -ArgumentList $arguments -WindowStyle Hidden -WorkingDirectory $data.state | Out-Null
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
    @{ error = @{ code = 'WINDOWS_NATIVE_FAILED'; message = $cause.Message; action = $Action } } | ConvertTo-Json -Depth 3 -Compress
    exit 1
}
