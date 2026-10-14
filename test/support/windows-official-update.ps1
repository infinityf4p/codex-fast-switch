param([string]$Root, [string]$Temporary)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
$tokens = $null; $errors = $null
$scriptFile = Join-Path $Root 'src\platforms\windows\official-update.ps1'
# Windows PowerShell 5.1 reads BOM-less scripts using the system ANSI code page.
# Both English and Chinese Windows must parse the production entry point.
foreach ($codePage in @(1252, 936)) {
    $text = [Text.Encoding]::GetEncoding($codePage).GetString([IO.File]::ReadAllBytes($scriptFile))
    [void][Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw ('Script does not parse on code page ' + $codePage + ': ' + ($errors | Out-String)) }
}
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Rejects([scriptblock]$operation, [string]$message) {
    try { & $operation } catch { if ($_.Exception.Message -notmatch $message) { throw }; return }
    throw ('Expected rejection: ' + $message)
}
$publisher = 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B'
$family = 'OpenAI.Codex_2p2nqsd0c76g0'
$data = [pscustomobject]@{ version = '26.1007.9446.0'; arch = 'x64'; length = $null; sha256 = $null }
$packageFile = Join-Path $Temporary 'official.msix'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function Make-Package([string]$manifest, [bool]$signature = $true) {
    if (Test-Path -LiteralPath $packageFile) { Remove-Item -LiteralPath $packageFile }
    $zip = [IO.Compression.ZipFile]::Open($packageFile, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $writer = New-Object IO.StreamWriter($zip.CreateEntry('AppxManifest.xml').Open())
        try { $writer.Write($manifest) } finally { $writer.Dispose() }
        if ($signature) { $zip.CreateEntry('AppxSignature.p7x') | Out-Null }
    } finally { $zip.Dispose() }
}
$manifest = '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Name="OpenAI.Codex" Publisher="' + $publisher + '" Version="26.1007.9446.0" ProcessorArchitecture="x64" /></Package>'
Make-Package $manifest
Assert-Package $packageFile
foreach ($invalid in @($manifest.Replace('OpenAI.Codex', 'Other.App'), $manifest.Replace('26.1007.9446.0', '26.1007.2314.0'), $manifest.Replace('x64', 'arm64'))) {
    Make-Package $invalid
    Rejects { Assert-Package $packageFile } 'does not match'
}
Make-Package $manifest $false
Rejects { Assert-Package $packageFile } 'signature is missing'
Make-Package ('<!DOCTYPE Package [<!ENTITY external SYSTEM "file:///must-not-read">]>' + $manifest)
Rejects { Assert-Package $packageFile } 'DTD'
Make-Package $manifest
$data.length = (Get-Item -LiteralPath $packageFile).Length + 1
Rejects { Assert-Package $packageFile } 'incomplete'
$data.length = $null
$data.sha256 = '0' * 64
Rejects { Assert-Package $packageFile } 'checksum'
$data.sha256 = $null

# Exercise the native deployment call through the real implementation, with
# mocked Windows registration and deployment so CI never installs an app.
$script:registeredVersion = '26.1007.2314.0'
function Get-AppxPackage {
    param($Name)
    @{ PackageFamilyName = $family; Publisher = $publisher; IsDevelopmentMode = $false; Status = 'Ok'; Version = $script:registeredVersion }
}
$script:deployments = 0
$script:windowChecks = 0
$script:signatureFailure = $false
function Assert-OfficialWindowStopped { $script:windowChecks++ }
function Add-AppxPackage {
    param($Path, [switch]$ForceTargetApplicationShutdown, $ErrorAction)
    Assert ($Path -ceq $packageFile) 'Unexpected installation path'
    Assert $ForceTargetApplicationShutdown 'Official service must not block deployment'
    $script:deployments++
    if ($script:signatureFailure) { throw 'Windows signature validation failed' }
    $script:registeredVersion = $data.version
}
Install-OfficialPackage
Assert ($script:deployments -eq 1 -and $script:windowChecks -eq 1) 'Expected one guarded official deployment'
Install-OfficialPackage
$script:registeredVersion = '27.0.0.0'
Install-OfficialPackage
Assert ($script:deployments -eq 1) 'Must never downgrade or repeat an installed update'
$script:registeredVersion = '26.1007.2314.0'
$script:signatureFailure = $true
Rejects { Install-OfficialPackage } 'Windows signature validation failed'
Assert ($script:registeredVersion -eq '26.1007.2314.0') 'Signature failure must preserve the registered app'
Write-Output 'Official package validation and deployment checks passed.'
