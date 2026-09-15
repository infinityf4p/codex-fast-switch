function Test-ShortcutFile([string]$file, [string[]]$roots) {
    $file = [IO.Path]::GetFullPath($file)
    if ([IO.Path]::GetExtension($file) -ine '.lnk') { return $false }
    foreach ($root in $roots) {
        $root = [IO.Path]::GetFullPath($root).TrimEnd('\')
        if (-not $file.StartsWith(($root + '\'), [StringComparison]::OrdinalIgnoreCase)) { continue }
        $current = $file
        while ($current -ine $root) {
            if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw "A shortcut path is redirected: $file"
            }
            $current = [IO.Path]::GetDirectoryName($current)
        }
        return $true
    }
    return $false
}

function Get-ShortcutHash([byte[]]$bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Update-AppShortcuts($data, [bool]$remove, [string[]]$roots = @(), [string]$programs = '') {
    $state = [IO.Path]::GetFullPath($data.state).TrimEnd('\')
    $agent = Join-Path $state 'agent'
    $script = Join-Path $agent 'src\platforms\windows\native.ps1'
    $launch = [ordered]@{ state = $state; node = (Join-Path $agent 'node.exe'); worker = (Join-Path $agent 'src\platforms\windows\cli.cjs') }
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($launch | ConvertTo-Json -Compress)))
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '" -Action launch -Payload ' + $payload
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not $programs) { $programs = [Environment]::GetFolderPath('Programs', [Environment+SpecialFolderOption]::Create) }
    if (-not $roots.Count) {
        $roots = @($programs, [Environment]::GetFolderPath('DesktopDirectory'),
            (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned')) | Where-Object { $_ }
    }
    $primary = Join-Path $programs ($data.shortcutName + '.lnk')
    $icon = Join-Path $agent 'Codex Fast.ico'
    $backups = Join-Path $agent 'shortcut-backups'
    foreach ($directory in @($agent, $backups)) {
        if ((Test-Path -LiteralPath $directory) -and ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "The shortcut backup directory is redirected: $directory"
        }
    }
    $journalPath = Join-Path $backups 'index.json'
    $journal = @{}
    if (Test-Path -LiteralPath $journalPath) {
        if ((Get-Item -LiteralPath $journalPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The shortcut index is redirected.' }
        $records = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
        foreach ($record in @($records.entries)) {
            if ($record.key -cnotmatch '^[a-f0-9]{64}$' -or $record.hash -cnotmatch '^[a-f0-9]{64}$' -or
                -not (Test-ShortcutFile $record.path $roots) -or
                $record.key -cne (Get-ShortcutHash ([Text.Encoding]::UTF8.GetBytes($record.path.ToLowerInvariant())))) {
                throw 'Invalid shortcut backup record.'
            }
            $journal[$record.key] = $record
        }
    }
    $shell = New-Object -ComObject WScript.Shell
    $shellApp = New-Object -ComObject Shell.Application
    $paths = @($roots | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
    })
    $officialBinaries = @($data.officialBinaries | Where-Object { $_ })
    $appIds = @($data.appIds | Where-Object { $_ })
    if ($data.redirectOfficial -and -not $data.PSObject.Properties['officialBinaries']) {
        foreach ($package in @(Get-AppxPackage -Name OpenAI.Codex | Where-Object { $_.Publisher -eq 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B' })) {
            $officialBinaries += Join-Path $package.InstallLocation 'app\ChatGPT.exe'
            $appIds += $package.PackageFamilyName + '!App'
        }
        if ($data.source) { $officialBinaries += Join-Path $data.source 'ChatGPT.exe' }
    }
    $result = @{ updated = @(); restored = @(); removed = @(); skipped = @() }
    if (-not $remove) {
        if (-not $data.maintenance -or -not (Test-Path -LiteralPath $icon)) {
            Add-Type -AssemblyName System.Drawing
            $image = [Drawing.Icon]::ExtractAssociatedIcon($data.binary)
            if (-not $image) { throw 'The application icon could not be read.' }
            $output = New-Object IO.MemoryStream
            try { $image.Save($output); $bytes = $output.ToArray() } finally { $output.Dispose(); $image.Dispose() }
            if (-not (Test-Path -LiteralPath $icon) -or (Get-ShortcutHash ([IO.File]::ReadAllBytes($icon))) -cne (Get-ShortcutHash $bytes)) {
                [IO.File]::WriteAllBytes($icon, $bytes)
            }
        }
        $paths += $primary
    }
    foreach ($file in @($paths | Select-Object -Unique)) {
        if (-not (Test-ShortcutFile $file $roots)) { continue }
        $exists = Test-Path -LiteralPath $file
        $shortcut = $shell.CreateShortcut($file)
        $owned = $shortcut.Arguments -ceq $arguments -and $shortcut.TargetPath -ieq $powershell
        $copy = $shortcut.TargetPath.StartsWith(($state + '\versions\'), [StringComparison]::OrdinalIgnoreCase) -and
            $shortcut.TargetPath.EndsWith('\app\ChatGPT.exe', [StringComparison]::OrdinalIgnoreCase)
        $key = Get-ShortcutHash ([Text.Encoding]::UTF8.GetBytes($file.ToLowerInvariant()))
        if ($remove) {
            if (-not $owned -and -not $copy) { continue }
            if ($journal.ContainsKey($key)) {
                $backup = Join-Path $backups ($key + '.lnk')
                if ((Get-Item -LiteralPath $backup -Force).Attributes -band [IO.FileAttributes]::ReparsePoint -or
                    (Get-ShortcutHash ([IO.File]::ReadAllBytes($backup))) -cne $journal[$key].hash) { throw 'A shortcut backup has changed.' }
                [IO.File]::Copy($backup, $file, $true)
                $result.restored += $file
            } else {
                Remove-Item -LiteralPath $file
                $result.removed += $file
            }
            continue
        }
        $official = $false
        $packaged = $false
        if ($data.redirectOfficial -and $exists -and -not $owned -and -not $copy) {
            $item = $shellApp.Namespace([IO.Path]::GetDirectoryName($file)).ParseName([IO.Path]::GetFileName($file))
            $appId = $item.ExtendedProperty('System.AppUserModel.ID')
            $parsingPath = $item.ExtendedProperty('System.Link.TargetParsingPath')
            $packaged = $appId -and $appIds -contains $appId
            $official = $officialBinaries -contains $shortcut.TargetPath
            foreach ($id in $appIds) {
                $destination = 'shell:AppsFolder\' + $id
                if ($shortcut.TargetPath -ieq (Join-Path $env:SystemRoot 'explorer.exe') -and
                    @($destination, ('"' + $destination + '"')) -icontains $shortcut.Arguments.Trim()) {
                    $official = $true
                }
                if ($parsingPath -ieq $destination -or $parsingPath -ieq ('::{4234d49b-0245-4df3-b780-3893943456e1}\' + $id)) { $packaged = $true }
            }
            if ($packaged -and -not $shortcut.Arguments) { $official = $true }
        }
        $custom = $shortcut.Arguments -and -not $owned -and -not ($official -and $shortcut.TargetPath -ieq (Join-Path $env:SystemRoot 'explorer.exe'))
        if ($file -eq $primary -and $exists -and -not $owned -and -not ($copy -and -not $custom)) {
            throw 'An unrelated Start menu shortcut already uses the Codex Fast name.'
        }
        if ($custom -or ($file -ne $primary -and -not $owned -and -not $copy -and -not $official)) {
            if ($copy -or $official -or $packaged) { $result.skipped += $file }
            continue
        }
        if ($owned -and $shortcut.IconLocation -ieq ($icon + ',0') -and $shortcut.WorkingDirectory -ieq $state -and $shortcut.WindowStyle -eq 7) { continue }
        if ($official -and -not $journal.ContainsKey($key)) {
            [void][IO.Directory]::CreateDirectory($backups)
            $original = [IO.File]::ReadAllBytes($file)
            $backup = Join-Path $backups ($key + '.lnk')
            if (Test-Path -LiteralPath $backup) { throw 'An untracked shortcut backup already exists.' }
            [IO.File]::WriteAllBytes($backup, $original)
            $journal[$key] = @{ key = $key; path = $file; hash = (Get-ShortcutHash $original) }
            $temporaryIndex = Join-Path $backups ([guid]::NewGuid().ToString() + '.tmp')
            [IO.File]::WriteAllText($temporaryIndex, (@{ entries = @($journal.Values) } | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
            Move-Item -LiteralPath $temporaryIndex -Destination $journalPath -Force
        }
        $temporaryLink = Join-Path ([IO.Path]::GetDirectoryName($file)) ([guid]::NewGuid().ToString() + '.lnk')
        try {
            # A fresh link removes a Store PIDL that can override its executable target.
            if ($exists -and -not $packaged) { [IO.File]::Copy($file, $temporaryLink, $false) }
            $replacement = $shell.CreateShortcut($temporaryLink)
            $replacement.TargetPath = $powershell
            $replacement.Arguments = $arguments
            $replacement.WorkingDirectory = $state
            $replacement.WindowStyle = 7
            $replacement.IconLocation = $icon + ',0'
            $replacement.Description = 'Codex Fast'
            $replacement.Hotkey = $shortcut.Hotkey
            $replacement.Save()
            Move-Item -LiteralPath $temporaryLink -Destination $file -Force
        } finally {
            if (Test-Path -LiteralPath $temporaryLink) { Remove-Item -LiteralPath $temporaryLink }
        }
        $result.updated += $file
    }
    $result | ConvertTo-Json -Depth 3 -Compress
}
