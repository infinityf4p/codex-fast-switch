param([string]$Implementation, [string]$Configuration, [string]$Trace)
$ErrorActionPreference = 'Stop'
$global:FastIdentityFixture = Get-Content -LiteralPath $Configuration -Raw | ConvertFrom-Json
$global:FastIdentityTrace = $Trace
$global:FastIdentityCalls = @()
$global:FastIdentityGetCount = 0
$global:FastIdentityAddCount = 0
$global:FastIdentityPackages = @($global:FastIdentityFixture.packages)
$global:FastIdentityStartup = $global:FastIdentityFixture.startup

function global:Save-FastIdentityTrace {
    $value = @{ calls = @($global:FastIdentityCalls); packages = @($global:FastIdentityPackages); startup = $global:FastIdentityStartup } | ConvertTo-Json -Depth 12 -Compress
    [IO.File]::WriteAllText($global:FastIdentityTrace, $value)
}

# Every package and process operation is replaced before invoking the real
# native script. These fixtures never enumerate or change Windows packages or
# startup registry entries.
function global:Assert-FastIdentityStartupKey([string]$key) {
    $expected = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\CodexFast.Switch_fixture\App'
    if ($key -cne $expected) { throw 'Unexpected startup registry scope.' }
}

function global:Test-Path {
    [CmdletBinding()]
    param([string]$LiteralPath)
    if ($LiteralPath.StartsWith('HKCU:')) {
        Assert-FastIdentityStartupKey $LiteralPath
        return $null -ne $global:FastIdentityStartup
    }
    Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath
}

function global:Get-ItemProperty {
    [CmdletBinding()]
    param([string]$LiteralPath)
    Assert-FastIdentityStartupKey $LiteralPath
    $global:FastIdentityStartup
}

function global:New-Item {
    [CmdletBinding()]
    param([string]$Path, [switch]$Force)
    Assert-FastIdentityStartupKey $Path
    $global:FastIdentityStartup = [pscustomobject]@{}
}

function global:New-ItemProperty {
    [CmdletBinding()]
    param([string]$LiteralPath, [string]$Name, [int]$Value, [string]$PropertyType, [switch]$Force)
    Assert-FastIdentityStartupKey $LiteralPath
    if ($Name -notin @('State', 'UserEnabledStartupOnce') -or $PropertyType -ne 'DWord') { throw 'Unexpected startup value.' }
    $global:FastIdentityCalls += @{ action = 'startup'; name = $Name; value = $Value }
    $global:FastIdentityStartup | Add-Member -MemberType NoteProperty -Name $Name -Value $Value -Force
    Save-FastIdentityTrace
}

function global:Get-AppxPackage {
    [CmdletBinding()]
    param([string]$Name, [switch]$AllUsers, [string]$User)
    if ($AllUsers -or $User -or $Name -cne 'CodexFast.Switch') { throw 'Unexpected package query scope.' }
    $global:FastIdentityGetCount++
    $global:FastIdentityCalls += @{ action = 'get'; name = $Name; errorAction = [string]$ErrorActionPreference }
    Save-FastIdentityTrace
    if (@($global:FastIdentityFixture.failGetAt) -contains $global:FastIdentityGetCount) { throw 'Mock package enumeration failed.' }
    @($global:FastIdentityPackages)
}

function global:Remove-AppxPackage {
    [CmdletBinding()]
    param([string]$Package, [switch]$AllUsers, [string]$User)
    if ($AllUsers -or $User) { throw 'Unexpected package removal scope.' }
    $global:FastIdentityCalls += @{ action = 'remove'; package = $Package; errorAction = [string]$ErrorActionPreference }
    Save-FastIdentityTrace
    if ($global:FastIdentityFixture.failRemove) { throw 'Mock package removal failed.' }
    if (-not $global:FastIdentityFixture.retainAfterRemove) {
        $global:FastIdentityPackages = @($global:FastIdentityPackages | Where-Object { $_.PackageFullName -cne $Package })
        $global:FastIdentityStartup = $null
    }
    Save-FastIdentityTrace
}

function global:Add-AppxPackage {
    [CmdletBinding()]
    param([string]$Register)
    $global:FastIdentityAddCount++
    $global:FastIdentityCalls += @{ action = 'add'; manifest = $Register; errorAction = [string]$ErrorActionPreference }
    Save-FastIdentityTrace
    if (@($global:FastIdentityFixture.failAddAt) -contains $global:FastIdentityAddCount) {
        throw ('Mock package registration failed #' + $global:FastIdentityAddCount + '.')
    }
    $directory = [IO.Path]::GetDirectoryName($Register)
    [xml]$manifest = [IO.File]::ReadAllText($Register)
    $global:FastIdentityStartup = if ($null -ne $global:FastIdentityFixture.registeredStartup) {
        $global:FastIdentityFixture.registeredStartup
    } else { [pscustomobject]@{ State = 0; UserEnabledStartupOnce = 0 } }
    $global:FastIdentityPackages = @([pscustomobject]@{
        Name = 'CodexFast.Switch'; Publisher = 'CN=CodexFastLocal'; Status = 'Ok'; Version = [string]$manifest.Package.Identity.Version;
        InstallLocation = $directory; PackageFullName = ('registered-' + [IO.Path]::GetFileName($directory));
        PackageFamilyName = 'CodexFast.Switch_fixture'
    })
    Save-FastIdentityTrace
}

function global:Get-Process {
    [CmdletBinding()]
    param()
    $global:FastIdentityCalls += @{ action = 'processes' }
    Save-FastIdentityTrace
    @($global:FastIdentityFixture.processes)
}

Save-FastIdentityTrace
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($global:FastIdentityFixture.payload | ConvertTo-Json -Depth 8 -Compress)))
$global:LASTEXITCODE = 0
& $Implementation -Action $global:FastIdentityFixture.action -Payload $payload
exit $LASTEXITCODE
