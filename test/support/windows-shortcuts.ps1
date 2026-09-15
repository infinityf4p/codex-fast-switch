param([string]$Implementation, [string]$Root)
$ErrorActionPreference = 'Stop'
. $Implementation
function Assert-True($condition, [string]$message) { if (-not $condition) { throw $message } }
function Link-Hash([string]$file) { Get-ShortcutHash ([IO.File]::ReadAllBytes($file)) }
$state = Join-Path $Root 'State with spaces'
$programs = Join-Path $Root 'Programs'
$desktop = Join-Path $Root 'Desktop'
$pins = Join-Path $Root 'Pins\ImplicitAppShortcuts\test'
$official = Join-Path $Root 'Official app\ChatGPT.exe'
$copy = Join-Path $state 'versions\old-generation\app\ChatGPT.exe'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
foreach ($directory in @((Join-Path $state 'agent'), $programs, $desktop, $pins, (Split-Path $official), (Split-Path $copy))) {
    [void][IO.Directory]::CreateDirectory($directory)
}
$wsh = New-Object -ComObject WScript.Shell
function New-TestLink([string]$file, [string]$target, [string]$arguments = '') {
    $link = $wsh.CreateShortcut($file)
    $link.TargetPath = $target
    $link.Arguments = $arguments
    $link.Description = 'Original test shortcut'
    $link.Save()
}
$originalLink = Join-Path $desktop 'Codex.lnk'
$copyLink = Join-Path $pins 'ChatGPT.lnk'
$customLink = Join-Path $desktop 'Codex Profile.lnk'
$customCopyLink = Join-Path $desktop 'Fast Profile.lnk'
$unrelatedLink = Join-Path $programs 'ChatGPT.lnk'
$storeLink = Join-Path $programs 'Store Codex.lnk'
$userChangedLink = Join-Path $desktop 'Another Codex.lnk'
$appsFolderLink = Join-Path $desktop 'Applications.lnk'
$appId = 'OpenAI.Codex_test!App'
New-TestLink $originalLink $official
New-TestLink $copyLink $copy
New-TestLink $customLink $official '--user-data-dir="C:\Custom Profile"'
New-TestLink $customCopyLink $copy '--user-data-dir="C:\Custom Profile"'
New-TestLink $unrelatedLink $powershell
New-TestLink $storeLink (Join-Path $env:SystemRoot 'explorer.exe') ('shell:AppsFolder\' + $appId)
New-TestLink $userChangedLink $official
New-TestLink $appsFolderLink (Join-Path $env:SystemRoot 'explorer.exe') 'shell:AppsFolder\'
$originalHash = Link-Hash $originalLink
$storeHash = Link-Hash $storeLink
$customHash = Link-Hash $customLink
$customCopyHash = Link-Hash $customCopyLink
$unrelatedHash = Link-Hash $unrelatedLink
$appsFolderHash = Link-Hash $appsFolderLink
$data = [pscustomobject]@{ state=$state; binary=$powershell; shortcutName='Codex Fast'; redirectOfficial=$true;
    officialBinaries=@($official); appIds=@($appId); maintenance=$false }
$roots = @($programs, $desktop, (Join-Path $Root 'Pins'))
$installed = Update-AppShortcuts $data $false $roots $programs | ConvertFrom-Json
Assert-True ($installed.updated.Count -eq 5) ('Expected the original, copy, Store link, additional original and primary to be redirected. Observed: ' + ($installed | ConvertTo-Json -Depth 3 -Compress))
Assert-True ($installed.skipped -contains $customLink) 'A custom profile must be reported as preserved.'
Assert-True ((Link-Hash $customLink) -eq $customHash) 'Custom profile arguments changed.'
Assert-True ((Link-Hash $customCopyLink) -eq $customCopyHash) 'Copy profile arguments changed during installation.'
Assert-True ((Link-Hash $unrelatedLink) -eq $unrelatedHash) 'An unrelated ChatGPT shortcut changed.'
Assert-True ((Link-Hash $appsFolderLink) -eq $appsFolderHash) 'The Applications folder shortcut changed.'
$primary = Join-Path $programs 'Codex Fast.lnk'
$launcher = $wsh.CreateShortcut($primary)
foreach ($file in @($originalLink, $copyLink, $storeLink)) {
    $link = $wsh.CreateShortcut($file)
    Assert-True ($link.TargetPath -eq $powershell -and $link.Arguments -ceq $launcher.Arguments) 'A shortcut does not use the stable launcher.'
}
$hashes = @($installed.updated | ForEach-Object { Link-Hash $_ })
$data.maintenance = $true
$repeated = Update-AppShortcuts $data $false $roots $programs | ConvertFrom-Json
Assert-True ($repeated.updated.Count -eq 0) 'Repeated maintenance rewrote unchanged shortcuts.'
Assert-True ((Compare-Object $hashes @($installed.updated | ForEach-Object { Link-Hash $_ })).Count -eq 0) 'Repeated maintenance changed shortcut bytes.'
New-TestLink $originalLink $copy
$repaired = Update-AppShortcuts $data $false $roots $programs | ConvertFrom-Json
Assert-True ($repaired.updated.Count -eq 1 -and $repaired.updated[0] -eq $originalLink) 'App-created shortcut drift was not repaired.'
New-TestLink $userChangedLink $powershell '-NoProfile'
$userChangedHash = Link-Hash $userChangedLink
$restored = Update-AppShortcuts $data $true $roots $programs | ConvertFrom-Json
Assert-True ($restored.restored.Count -eq 2) 'Original shortcuts were not restored.'
Assert-True ((Link-Hash $originalLink) -eq $originalHash) 'The original executable shortcut was not restored exactly.'
Assert-True ((Link-Hash $storeLink) -eq $storeHash) 'The original Store shortcut was not restored exactly.'
Assert-True ((Link-Hash $userChangedLink) -eq $userChangedHash) 'Uninstall overwrote a user change.'
Assert-True (-not (Test-Path -LiteralPath $primary) -and -not (Test-Path -LiteralPath $copyLink)) 'Owned Fast links remain after removal.'
Assert-True (-not (Test-Path -LiteralPath $customCopyLink)) 'A custom shortcut still points to an uninstalled copy.'

# An isolated install must not redirect the personal official app's shortcuts.
$isolatedState = Join-Path $Root 'Isolated state'
[void][IO.Directory]::CreateDirectory((Join-Path $isolatedState 'agent'))
$data.state = $isolatedState
$data.redirectOfficial = $false
$isolated = Update-AppShortcuts $data $false $roots $programs | ConvertFrom-Json
Assert-True ($isolated.updated.Count -eq 1) 'An isolated state redirected official shortcuts.'
Assert-True ((Link-Hash $originalLink) -eq $originalHash -and (Link-Hash $storeLink) -eq $storeHash) 'An isolated state changed an official shortcut.'
[void](Update-AppShortcuts $data $true $roots $programs)

$data.state = $state
$journalFile = Join-Path $state 'agent\shortcut-backups\index.json'
$journal = Get-Content -LiteralPath $journalFile -Raw | ConvertFrom-Json
$journal.entries[0].path = Join-Path $Root 'Outside roots.lnk'
$journal.entries[0].key = Get-ShortcutHash ([Text.Encoding]::UTF8.GetBytes($journal.entries[0].path.ToLowerInvariant()))
[IO.File]::WriteAllText($journalFile, ($journal | ConvertTo-Json -Depth 4))
$rejected = $false
try { [void](Update-AppShortcuts $data $true $roots $programs) } catch { $rejected = $_.Exception.Message -eq 'Invalid shortcut backup record.' }
Assert-True $rejected 'An out-of-scope restoration record was accepted.'
[pscustomobject]@{ passed=$true; originalRestored=$true; storeShortcutRestored=$true; driftRepaired=$true;
    customArgumentsPreserved=$true; userChangesPreserved=$true; isolatedInstallPreservedOfficial=$true; invalidRecordRejected=$true } | ConvertTo-Json -Compress
