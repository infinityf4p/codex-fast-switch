param([string]$Implementation, [string]$Configuration, [string]$Trace)
$ErrorActionPreference = 'Stop'
$global:FastIdentityFixture = Get-Content -LiteralPath $Configuration -Raw | ConvertFrom-Json
$global:FastIdentityTrace = $Trace
$global:FastIdentityCalls = @()
$global:FastIdentityGetCount = 0
$global:FastIdentityAddCount = 0
$global:FastIdentityPackages = @($global:FastIdentityFixture.packages)

function global:Save-FastIdentityTrace {
    $value = @{ calls = @($global:FastIdentityCalls); packages = @($global:FastIdentityPackages) } | ConvertTo-Json -Depth 12 -Compress
    [IO.File]::WriteAllText($global:FastIdentityTrace, $value)
}

# Every package and process operation is replaced before invoking the real
# native script. These fixtures never enumerate or change Windows packages.
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
    $global:FastIdentityPackages = @([pscustomobject]@{
        Name = 'CodexFast.Switch'; Publisher = 'CN=CodexFastLocal'; Status = 'Ok'; Version = '1.0.0.0';
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
